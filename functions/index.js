import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

initializeApp();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_API_URL = defineSecret("GEMINI_API_URL");
const DEFAULT_AI_MODEL = defineSecret("DEFAULT_AI_MODEL");

export const notifyMeetingsScheduled = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Bogota",
    memory: "256MiB",
    region: "us-central1",
  },
  async () => {
    const db = getFirestore();
    const eventId = "DKyGhDkDlzXRBfnCxnrk";

    const nowUTC = new Date();
    const nowBogota = new Date(nowUTC.toLocaleString("en-US", { timeZone: "America/Bogota" }));

    console.log("🕒 Buscando reuniones para el evento:", eventId);
    console.log("⏰ Hora actual en Bogotá:", nowBogota.toLocaleString("es-CO"));

    try {
      const eventRef = db.collection("events").doc(eventId);
      const eventDoc = await eventRef.get();

      if (!eventDoc.exists) {
        console.log("❌ Evento no encontrado");
        return null;
      }

      const eventData = eventDoc.data();
      const eventDate = new Date(eventData.config.eventDate);
      const meetingsRef = eventRef.collection("meetings");
      const meetingsSnap = await meetingsRef.where("status", "==", "accepted").get();

      if (meetingsSnap.empty) {
        console.log("❌ No hay reuniones aceptadas");
        return null;
      }

      const notifications = [];

      for (const doc of meetingsSnap.docs) {
        const meeting = doc.data();
        const [startStr] = meeting.timeSlot.split(" - ");
        const [hour, minute] = startStr.split(":").map(Number);

        const meetingStart = new Date(eventDate);
        meetingStart.setHours(hour, minute, 0, 0);

        const diff = meetingStart.getTime() - nowBogota.getTime();
        const diffMinutes = Math.round(diff / 60000);

        console.log(`⏰ Reunión ${doc.id}: ${diffMinutes} minutos`);

        if (diff > 0 && diff <= 5 * 60 * 1000) {
          console.log(`📅 Notificando reunión ${doc.id}`);

          for (const uid of meeting.participants) {
            const userDoc = await db.collection("users").doc(uid).get();

            if (!userDoc.exists) {
              console.log(`⚠️ Usuario no encontrado: ${uid}`);
              continue;
            }

            const user = userDoc.data();
            const phone = user.telefono?.replace(/\D/g, "");

            if (!phone) {
              console.log(`⚠️ Usuario ${user.nombre} no tiene teléfono`);
              continue;
            }

            const message = `👋 Hola ${user.nombre?.trim() || "asistente"}!
Recuerde que tiene una reunión asignada (${meeting.timeSlot}) y su reunión de networking ${eventData.eventName.toUpperCase() || "START"} empezará en menos de 5 minutos.
Por favor diríjase a su mesa asignada (${meeting.tableAssigned}).`;

            console.log(`📲 Enviando WhatsApp a ${user.nombre} (${phone})...`);

            try {
              const resp = await fetch("https://apiwhatsapp.geniality.com.co/api/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  clientId: "genialitybussiness",
                  phone: `57${phone}`,
                  message,
                }),
              });

              if (resp.ok) {
                console.log(`✅ WhatsApp enviado a ${user.nombre}`);
                notifications.push({ uid, phone, meetingId: doc.id });
              } else {
                const errorText = await resp.text();
                console.log(`❌ Error enviando WhatsApp:`, errorText);
              }
            } catch (err) {
              console.error(`💥 Error en WhatsApp:`, err);
            }
          }
        }
      }

      console.log(`✅ Notificaciones enviadas: ${notifications.length}`);
      return null;
    } catch (error) {
      console.error("💥 Error:", error);
      throw error;
    }
  }
);

// HTTP AI proxy: recibe { userId, eventId, message }
export const aiProxy = onRequest(
  { region: "us-central1", memory: "512MiB", secrets: [GEMINI_API_KEY, GEMINI_API_URL, DEFAULT_AI_MODEL], },
  async (req, res) => {
    // Set CORS headers for preflight requests and responses
    const origin = req.headers.origin || "*";
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Credentials": "true",
    });

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      if (req.method !== "POST") {
        res.status(405).send({ error: "Method not allowed" });
        return;
      }

      const body = req.body || {};
      const userId = body.userId;
      let eventId = body.eventId || null;
      const message = body.message;
      // optional profile fields sent from frontend
      const descripcion = body.descripcion || null;
      const necesidad = body.necesidad || null;
      const interesPrincipal = body.interesPrincipal || null;
      const tipoAsistente = body.tipoAsistente || null;
      const companyNit = body.companyNit || null;
      
      if (!userId || !message) {
        res.status(400).send({ error: "Missing userId or message" });
        return;
      }
      
      console.log(`AI Proxy request from user ${userId} (event: ${eventId || "N/A"}), message length: ${String(message).length}`);
      
      // If eventId not provided, try to derive it from the user's document
      const db = getFirestore();
      if (!eventId) {
        try {
          const userDoc = await db.collection("users").doc(userId).get();
          if (userDoc.exists) {
            const ud = userDoc.data();
            if (ud && ud.eventId) eventId = ud.eventId;
          }
        } catch (deriveErr) {
          console.warn("Could not derive eventId from user", deriveErr);
        }
      }

      // ========================================================================
      // PASO 1: Clasificar la intención del usuario
      // ========================================================================
      const profileParts = [];
      if (descripcion) profileParts.push(`descripcion: ${descripcion}`);
      if (necesidad) profileParts.push(`necesidad: ${necesidad}`);
      if (interesPrincipal) profileParts.push(`interesPrincipal: ${interesPrincipal}`);
      if (tipoAsistente) profileParts.push(`tipoAsistente: ${tipoAsistente}`);

      const profileText = profileParts.length ? `\nPerfil del usuario:\n${profileParts.join('\n')}` : "";
      
      const intentPrompt = `Eres un asistente experto en clasificar intenciones de búsqueda para una plataforma de networking de eventos empresariales.

Analiza el mensaje del usuario y clasifica su intención en una de estas categorías:
1. "search_query": El usuario busca asistentes, empresas, productos, reuniones o información específica del evento
2. "general_question": El usuario hace una pregunta general que puedes responder (no relacionada con búsqueda en la base de datos)
3. "greeting": Saludo, conversación casual o mensaje sin intención clara
4. "meeting_related": Consultas sobre reuniones (programadas, disponibilidad, solicitudes)

Considera que búsquedas pueden incluir:
- Buscar personas por empresa, sector, necesidades
- Buscar productos o servicios específicos
- Buscar empresas por tipo, sector, ubicación
- Consultar reuniones programadas o disponibles

Devuelve ÚNICAMENTE un objeto JSON con esta estructura:
{
  "intent": "search_query | general_question | greeting | meeting_related",
  "confidence": 0.0-1.0,
  "keywords": ["palabra1", "palabra2"],
  "scopes": ["assistants", "products", "companies", "meetings"],
  "reasoning": "breve explicación de por qué clasificaste así"
}

Mensaje del usuario: "${message.replace(/"/g, '\\"')}"${profileText}`;

      let intentAnalysis = null;
      try {
        const intentResp = await callGeminiAPI(intentPrompt, 0.3, 600, "application/json");
        intentAnalysis = parseAIResponse(intentResp);
        console.log("Intent analysis:", intentAnalysis);
      } catch (err) {
        console.error("Intent classification failed:", err);
        // Fallback conservador: asumir búsqueda
        intentAnalysis = {
          intent: "search_query",
          confidence: 0.5,
          keywords: extractSimpleKeywords(message),
          scopes: ["assistants", "products", "companies"]
        };
      }

      // ========================================================================
      // PASO 2: Manejar según la intención detectada
      // ========================================================================

      // Caso 1: Saludo o mensaje casual
      if (intentAnalysis.intent === "greeting") {
        const greetingResponse = await handleGreeting(message, profileText);
        const chatRef = db.collection("aiChats").doc();
        await chatRef.set({
          userId,
          eventId: eventId || null,
          message,
          profile: buildProfileObject(descripcion, necesidad, interesPrincipal, tipoAsistente),
          intent: "greeting",
          keywords: [],
          scopes: [],
          aiMessage: greetingResponse,
          summary: null,
          resultsSummary: { assistants: 0, products: 0, companies: 0, meetings: 0 },
          isGreeting: true,
          createdAt: new Date().toISOString(),
        });

        res.status(200).send({
          chatId: chatRef.id,
          intent: "greeting",
          results: { assistants: [], products: [], companies: [], meetings: [] },
          message: greetingResponse,
          summary: null,
          isGreeting: true
        });
        return;
      }

      // Caso 2: Pregunta general (no requiere búsqueda en DB)
      if (intentAnalysis.intent === "general_question") {
        const generalResponse = await handleGeneralQuestion(message, profileText);
        const chatRef = db.collection("aiChats").doc();
        await chatRef.set({
          userId,
          eventId: eventId || null,
          message,
          profile: buildProfileObject(descripcion, necesidad, interesPrincipal, tipoAsistente),
          intent: "general_question",
          keywords: intentAnalysis.keywords || [],
          scopes: [],
          aiMessage: generalResponse,
          summary: null,
          resultsSummary: { assistants: 0, products: 0, companies: 0, meetings: 0 },
          isGreeting: false,
          createdAt: new Date().toISOString(),
        });

        res.status(200).send({
          chatId: chatRef.id,
          intent: "general_question",
          results: { assistants: [], products: [], companies: [], meetings: [] },
          message: generalResponse,
          summary: null,
          isGreeting: false
        });
        return;
      }

      // ========================================================================
      // PASO 3: Búsqueda en base de datos (search_query o meeting_related)
      // ========================================================================

      // Refinar keywords y scopes
      const keywords = cleanAndNormalizeKeywords(
        intentAnalysis.keywords || [],
        [descripcion, necesidad, interesPrincipal]
      );
      const scopes = intentAnalysis.scopes && intentAnalysis.scopes.length > 0 
        ? intentAnalysis.scopes 
        : ["assistants", "products", "companies"];

      console.log("Refined search - scopes:", scopes, "keywords:", keywords);

      // Lógica de inversión de tipo (vendedor busca compradores, etc.)
      const userTipo = tipoAsistente ? String(tipoAsistente).toLowerCase() : null;
      let desiredOpposite = null;
      if (userTipo === "vendedor") desiredOpposite = "comprador";
      else if (userTipo === "comprador") desiredOpposite = "vendedor";

      const results = { 
        assistants: [], 
        products: [], 
        companies: [], 
        meetings: [] 
      };

      // Helper para matching
      const matchesAny = (obj, fields) => {
        const text = fields
          .map((f) => (obj[f] || ""))
          .join(" ")
          .toLowerCase();
        return keywords.some((kw) => text.includes(kw));
      };

      // Buscar Asistentes
      if (scopes.includes("assistants")) {
        try {
          const usersQuery = eventId 
            ? db.collection("users").where("eventId", "==", eventId) 
            : db.collection("users");
          const usersSnap = await usersQuery.get();
          
          usersSnap.forEach((d) => {
            if (d.id === userId) return; // excluir al usuario mismo
            const o = d.data();
            
            // Filtrar por tipo opuesto si aplica
            if (desiredOpposite) {
              const otherType = (o.tipoAsistente || "").toString().toLowerCase();
              if (otherType !== desiredOpposite) return;
            }
            
            if (matchesAny(o, [
              "nombre",
              "empresa",
              "company_razonSocial",
              "descripcion",
              "interesPrincipal",
              "necesidad",
            ])) {
              results.assistants.push({ id: d.id, ...o });
            }
          });
        } catch (err) {
          console.warn("Assistants query failed", err);
        }
      }

      // Buscar Productos
      if (scopes.includes("products")) {
        try {
          if (eventId) {
            const productsSnap = await db.collection("events")
              .doc(eventId)
              .collection("products")
              .get();
            
            productsSnap.forEach((d) => {
              const o = d.data();
              if (matchesAny(o, ["title", "description", "category"])) {
                results.products.push({ id: d.id, ...o });
              }
            });
          }
        } catch (err) {
          console.warn("Products query failed", err);
        }
      }

      // Buscar Empresas (con asistentes incluidos)
      if (scopes.includes("companies")) {
        try {
          if (eventId) {
            let companiesSnap = null;
            if (companyNit) {
              companiesSnap = await db.collection("events")
                .doc(eventId)
                .collection("companies")
                .where("nitNorm", "!=", companyNit)
                .get()
                .catch(() => null);
            } else {
              companiesSnap = await db.collection("events")
                .doc(eventId)
                .collection("companies")
                .get()
                .catch(() => null);
            }

            if (companiesSnap) {
              for (const d of companiesSnap.docs) {
                const o = d.data();
                if (matchesAny(o, ["razonSocial", "descripcion"])) {
                  // Buscar asistentes de la empresa
                  let companyAssistants = [];
                  if (o.nitNorm) {
                    try {
                      const assistantsSnap = await db.collection("users")
                        .where("eventId", "==", eventId)
                        .where("company_nit", "==", o.nitNorm)
                        .get();
                      companyAssistants = assistantsSnap.docs
                        .filter((ad) => ad.id !== userId) // Excluir al usuario actual
                        .map((ad) => ({ 
                          id: ad.id, 
                          ...ad.data() 
                        }));
                    } catch (err) {
                      console.warn(`Error fetching assistants for company ${o.razonSocial}`, err);
                    }
                  }
                  results.companies.push({ 
                    id: d.id, 
                    ...o, 
                    assistants: companyAssistants 
                  });
                }
              }
            }
          }
        } catch (err) {
          console.warn("Companies query failed", err);
        }
      }

      // Buscar Reuniones (si el scope lo incluye)
      if (scopes.includes("meetings")) {
        try {
          if (eventId) {
            // Buscar reuniones donde el usuario es participante
            const meetingsSnap = await db.collection("events")
              .doc(eventId)
              .collection("meetings")
              .where("participants", "array-contains", userId)
              .get()
              .catch(() => null);

            if (meetingsSnap) {
              console.log(`Found ${meetingsSnap.docs.length} meetings for user ${userId}`);
              // Procesar cada reunión y obtener info de la contraparte
              for (const d of meetingsSnap.docs) {
                const meetingData = d.data();
                
                // Determinar quién es la contraparte
                const counterpartId = meetingData.requesterId === userId 
                  ? meetingData.receiverId 
                  : meetingData.requesterId;

                // Buscar información de la contraparte
                let counterpartInfo = null;
                if (counterpartId) {
                  try {
                    const counterpartDoc = await db.collection("users").doc(counterpartId).get();
                    if (counterpartDoc.exists) {
                      const counterpartData = counterpartDoc.data();
                      counterpartInfo = {
                        id: counterpartId,
                        nombre: counterpartData.nombre || "Sin nombre",
                        empresa: counterpartData.empresa || counterpartData.company_razonSocial || "Sin empresa",
                        tipoAsistente: counterpartData.tipoAsistente || null,
                        descripcion: counterpartData.descripcion || null,
                        photoURL: counterpartData.photoURL || null,
                      };
                    }
                  } catch (err) {
                    console.warn(`Error fetching counterpart info for meeting ${d.id}:`, err);
                  }
                }

                // Construir objeto de reunión enriquecido
                const enrichedMeeting = {
                  id: d.id,
                  status: meetingData.status,
                  createdAt: meetingData.createdAt,
                  updatedAt: meetingData.updatedAt || null,
                  requesterId: meetingData.requesterId,
                  receiverId: meetingData.receiverId,
                  participants: meetingData.participants || [],
                  counterpart: counterpartInfo,
                  isRequester: meetingData.requesterId === userId,
                };

                // Agregar campos específicos para reuniones aceptadas
                if (meetingData.status === "accepted") {
                  enrichedMeeting.meetingDate = meetingData.meetingDate || null;
                  enrichedMeeting.timeSlot = meetingData.timeSlot || null;
                  enrichedMeeting.startMinutes = meetingData.startMinutes || null;
                  enrichedMeeting.endMinutes = meetingData.endMinutes || null;
                  enrichedMeeting.tableAssigned = meetingData.tableAssigned || null;
                  enrichedMeeting.slotId = meetingData.slotId || null;
                }

                // Aplicar filtro de keywords si existen Y no son relacionadas con reuniones
                const meetingRelatedKeywords = [
                  'reunion', 'reuniones', 'meeting', 'meetings', 
                  'pendiente', 'pendientes', 'pending',
                  'aceptada', 'aceptadas', 'accepted', 'confirmada', 'confirmadas',
                  'rechazada', 'rechazadas', 'rejected',
                  'programada', 'programadas', 'scheduled'
                ];
                
                const hasMeetingKeyword = keywords.some(kw => 
                  meetingRelatedKeywords.some(mk => kw.includes(mk) || mk.includes(kw))
                );

                // Si hay keywords relacionadas con reuniones, incluir TODAS las reuniones del usuario
                if (hasMeetingKeyword || keywords.length === 0) {
                  results.meetings.push(enrichedMeeting);
                } else if (keywords.length > 0) {
                  // Si hay keywords pero NO son de reuniones, filtrar por coincidencia
                  const meetingText = [
                    meetingData.status,
                    counterpartInfo?.nombre,
                    counterpartInfo?.empresa,
                    counterpartInfo?.descripcion,
                    meetingData.meetingDate,
                    meetingData.timeSlot,
                  ].filter(Boolean).join(" ").toLowerCase();

                  const hasMatch = keywords.some(kw => meetingText.includes(kw));
                  if (hasMatch) {
                    results.meetings.push(enrichedMeeting);
                  }
                }
              }
            }
            console.log(`Meetings after filtering: ${results.meetings.length}`);
          }
        } catch (err) {
          console.warn("Meetings query failed", err);
        }
      }

      // ========================================================================
      // PASO 4: Análisis de compatibilidad con IA
      // ========================================================================

      let rankedResults = { ...results };
      let aiAnalysisMessage = "";
      
      const totalResults = results.assistants.length + results.products.length + 
                          results.companies.length + results.meetings.length;

      if (totalResults > 0) {
        // Generar análisis de compatibilidad
        const analysisResult = await analyzeResultsWithAI(
          message,
          results,
          profileText,
          keywords,
          userTipo
        );

        rankedResults = analysisResult.rankedResults;
        aiAnalysisMessage = analysisResult.message;
      } else {
        // No hay resultados - sugerir alternativas
        aiAnalysisMessage = await generateNoResultsMessage(message, keywords, scopes);
      }

      // ========================================================================
      // PASO 5: Guardar en base de datos y responder
      // ========================================================================

      const summary = `Encontré ${rankedResults.assistants.length} asistente${rankedResults.assistants.length !== 1 ? "s" : ""}, ${rankedResults.products.length} producto${rankedResults.products.length !== 1 ? "s" : ""}, ${rankedResults.companies.length} empresa${rankedResults.companies.length !== 1 ? "s" : ""}${rankedResults.meetings.length > 0 ? ` y ${rankedResults.meetings.length} reunión${rankedResults.meetings.length !== 1 ? "es" : ""}` : ""}.`;

      const chatRef = db.collection("aiChats").doc();
      await chatRef.set({
        userId,
        eventId: eventId || null,
        message,
        profile: buildProfileObject(descripcion, necesidad, interesPrincipal, tipoAsistente),
        intent: intentAnalysis.intent,
        keywords,
        scopes,
        aiMessage: aiAnalysisMessage,
        summary,
        resultsSummary: {
          assistants: rankedResults.assistants.length,
          products: rankedResults.products.length,
          companies: rankedResults.companies.length,
          meetings: rankedResults.meetings.length,
        },
        isGreeting: false,
        createdAt: new Date().toISOString(),
        intentAnalysis,
      });

      res.status(200).send({ 
        chatId: chatRef.id, 
        intent: intentAnalysis.intent,
        results: rankedResults, 
        message: aiAnalysisMessage, 
        summary 
      });

    } catch (err) {
      console.error("aiProxy error", err);
      res.status(500).send({ error: "internal_error", details: err.message });
    }
  },
);

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

/**
 * Llamada genérica a Gemini API
 */
async function callGeminiAPI(prompt, temperature = 0.5, maxTokens = 512, mimeType = "application/json") {
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: mimeType,
    },
  };

  try {
    const response = await fetch(
      `${GEMINI_API_URL.value()}/models/${DEFAULT_AI_MODEL.value()}:generateContent?key=${GEMINI_API_KEY.value()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API failed: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error("callGeminiAPI error:", err);
    throw err;
  }
}

/**
 * Extrae el texto de la respuesta de Gemini
 */
function parseAIResponse(aiJson) {
  let aiText = "";
  
  if (aiJson?.candidates?.[0]?.content?.parts?.[0]?.text) {
    aiText = aiJson.candidates[0].content.parts[0].text;
  } else if (aiJson?.output) {
    aiText = typeof aiJson.output === "string" ? aiJson.output : JSON.stringify(aiJson.output);
  } else {
    aiText = JSON.stringify(aiJson);
  }

  try {
    const jsonStart = aiText.indexOf("{");
    const jsonStr = jsonStart >= 0 ? aiText.slice(jsonStart) : aiText;
    return JSON.parse(jsonStr);
  } catch (err) {
    console.warn("Could not parse AI response as JSON:", err);
    return { text: aiText };
  }
}

/**
 * Maneja saludos y mensajes casuales
 */
async function handleGreeting(message, profileText) {
  const greetingPrompt = `Eres un asistente virtual profesional y amigable para networking en eventos empresariales.

El usuario te ha enviado un saludo o mensaje casual. Responde de manera natural, cordial y profesional. 

Luego, invita sutilmente al usuario a aprovechar las funcionalidades de búsqueda, mencionando que puede:
- Buscar asistentes por empresa, sector, rol o necesidades
- Explorar empresas y sus productos
- Consultar sus reuniones programadas
- Encontrar oportunidades de networking relevantes

Sé breve (máximo 3-4 líneas), cálido y evita sonar robótico. No uses emojis excesivos.

Mensaje del usuario: "${message.replace(/"/g, '\\"')}"${profileText}

Responde en español de forma natural y profesional:`;

  try {
    const response = await callGeminiAPI(greetingPrompt, 0.7, 150, "text/plain");
    const parsed = parseAIResponse(response);
    return parsed.text || "¡Hola! Estoy aquí para ayudarte a conectar con las personas y empresas adecuadas en este evento. ¿En qué puedo asistirte hoy?";
  } catch (err) {
    console.warn("Greeting generation failed:", err);
    return "¡Hola! Estoy aquí para ayudarte a encontrar asistentes, empresas y productos relevantes para ti. ¿Qué te gustaría buscar?";
  }
}

/**
 * Maneja preguntas generales (no requieren búsqueda en DB)
 */
async function handleGeneralQuestion(message, profileText) {
  const questionPrompt = `Eres un asistente virtual experto en eventos de networking empresarial.

El usuario ha hecho una pregunta general. Responde de manera útil, precisa y profesional.

Si la pregunta podría resolverse mejor con una búsqueda en la base de datos del evento (asistentes, empresas, productos, reuniones), menciona esta opción al final de tu respuesta.

Mensaje del usuario: "${message.replace(/"/g, '\\"')}"${profileText}

Responde de forma clara, concisa y profesional (máximo 5-6 líneas):`;

  try {
    const response = await callGeminiAPI(questionPrompt, 0.6, 200, "text/plain");
    const parsed = parseAIResponse(response);
    return parsed.text || "Entiendo tu pregunta. ¿Podrías darme más detalles para ayudarte mejor?";
  } catch (err) {
    console.warn("General question response failed:", err);
    return "Puedo ayudarte con eso. ¿Podrías proporcionar más información sobre lo que necesitas?";
  }
}

/**
 * Analiza resultados de búsqueda con IA y los rankea por compatibilidad
 */
async function analyzeResultsWithAI(message, results, profileText, keywords) {
  // Preparar datos resumidos para el análisis
  const assistantsSummary = results.assistants.slice(0, 20).map(a => ({
    id: a.id,
    nombre: a.nombre,
    empresa: a.empresa || a.company_razonSocial,
    descripcion: a.descripcion,
    necesidad: a.necesidad,
    interesPrincipal: a.interesPrincipal,
    tipoAsistente: a.tipoAsistente,
  }));

  const productsSummary = results.products.slice(0, 20).map(p => ({
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
  }));

  const companiesSummary = results.companies.slice(0, 20).map(c => ({
    id: c.id,
    razonSocial: c.razonSocial,
    descripcion: c.descripcion,
    assistantsCount: c.assistants?.length || 0,
  }));

  const meetingsSummary = results.meetings.slice(0, 10).map(m => ({
    id: m.id,
    status: m.status,
    isRequester: m.isRequester,
    meetingDate: m.meetingDate || null,
    timeSlot: m.timeSlot || null,
    tableAssigned: m.tableAssigned || null,
    counterpart: m.counterpart ? {
      nombre: m.counterpart.nombre,
      empresa: m.counterpart.empresa,
      tipoAsistente: m.counterpart.tipoAsistente,
    } : null,
  }));

  const analysisPrompt = `Eres un asistente experto en networking empresarial. Analiza los resultados de búsqueda y genera una respuesta personalizada.

CONSULTA DEL USUARIO: "${message}"
PALABRAS CLAVE: ${keywords.join(", ")}
${profileText}

RESULTADOS ENCONTRADOS:
${assistantsSummary.length > 0 ? `\nASISTENTES (${assistantsSummary.length}):\n${JSON.stringify(assistantsSummary, null, 2)}` : ""}
${productsSummary.length > 0 ? `\nPRODUCTOS (${productsSummary.length}):\n${JSON.stringify(productsSummary, null, 2)}` : ""}
${companiesSummary.length > 0 ? `\nEMPRESAS (${companiesSummary.length}):\n${JSON.stringify(companiesSummary, null, 2)}` : ""}
${meetingsSummary.length > 0 ? `\nREUNIONES (${meetingsSummary.length}):\n${JSON.stringify(meetingsSummary, null, 2)}\n\nNota sobre reuniones: 
- status "pending" = solicitud enviada/recibida esperando respuesta
- status "accepted" = reunión confirmada con fecha, hora y mesa asignada
- status "rejected" = solicitud rechazada
- isRequester: true = usuario envió la solicitud, false = usuario recibió la solicitud` : ""}

TAREA:
1. Analiza la compatibilidad de cada resultado con la consulta del usuario
2. Para reuniones: indica claramente el estado (pendiente/aceptada/rechazada) y con quién es
3. Identifica los 3-5 resultados MÁS compatibles y explica por qué
4. Menciona también 1-2 resultados MENOS compatibles (si aplica)
5. Da recomendaciones prácticas al usuario

Devuelve un JSON con esta estructura:
{
  "message": "Respuesta natural y profesional al usuario (máximo 250 palabras). Menciona específicamente los resultados más relevantes y por qué son útiles para él.",
  "rankings": {
    "assistants": ["id1", "id2", "id3"],
    "products": ["id1", "id2"],
    "companies": ["id1", "id2"],
    "meetings": ["id1"]
  },
  "insights": "Breve insight sobre los patrones encontrados"
}

Sé específico, menciona nombres y razones concretas. Habla en español de forma natural y profesional.`;

  try {
    const response = await callGeminiAPI(analysisPrompt, 0.5, 800, "application/json");
    const analysis = parseAIResponse(response);

    // Reordenar resultados según el ranking de la IA
    const rankedResults = {
      assistants: reorderByRanking(results.assistants, analysis.rankings?.assistants || []),
      products: reorderByRanking(results.products, analysis.rankings?.products || []),
      companies: reorderByRanking(results.companies, analysis.rankings?.companies || []),
      meetings: reorderByRanking(results.meetings, analysis.rankings?.meetings || []),
    };

    return {
      rankedResults,
      message: analysis.message || "He encontrado varios resultados que podrían interesarte.",
      insights: analysis.insights,
    };
  } catch (err) {
    console.error("AI analysis failed:", err);
    // Fallback: devolver resultados sin ranking
    return {
      rankedResults: results,
      message: `He encontrado ${results.assistants.length} asistentes, ${results.products.length} productos y ${results.companies.length} empresas que coinciden con tu búsqueda.`,
    };
  }
}

/**
 * Reordena un array según un ranking de IDs
 */
function reorderByRanking(items, rankedIds) {
  if (!rankedIds || rankedIds.length === 0) return items;
  
  const ranked = [];
  const unranked = [];

  // Primero agregar los items en el orden del ranking
  rankedIds.forEach(id => {
    const item = items.find(i => i.id === id);
    if (item) ranked.push(item);
  });

  // Luego agregar los que no están en el ranking
  items.forEach(item => {
    if (!rankedIds.includes(item.id)) {
      unranked.push(item);
    }
  });

  return [...ranked, ...unranked];
}

/**
 * Genera mensaje cuando no hay resultados
 */
async function generateNoResultsMessage(message, keywords, scopes) {
  const noResultsPrompt = `El usuario buscó información pero no se encontraron resultados en la base de datos.

BÚSQUEDA: "${message}"
PALABRAS CLAVE: ${keywords.join(", ")}
ALCANCE: ${scopes.join(", ")}

Genera una respuesta profesional y útil que:
1. Reconozca que no se encontraron resultados exactos
2. Sugiera ajustar la búsqueda (ser más específico o más general)
3. Ofrezca alternativas (buscar por otros términos, explorar categorías)
4. Mantenga un tono alentador y profesional

Responde en español (máximo 4-5 líneas):`;

  try {
    const response = await callGeminiAPI(noResultsPrompt, 0.6, 180, "text/plain");
    const parsed = parseAIResponse(response);
    return parsed.text || "No encontré resultados exactos. Intenta ajustar tu búsqueda o usar términos más generales.";
  } catch (err) {
    console.warn("No results message generation failed:", err);
    return "No encontré resultados con esos criterios. Intenta buscar con términos diferentes o más generales para mejores resultados.";
  }
}

/**
 * Limpia y normaliza keywords
 */
function cleanAndNormalizeKeywords(aiKeywords, profileFields) {
  const normalizeText = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();

  const extractWords = (s) => 
    (normalizeText(s).match(/\p{L}+/gu) || [])
      .map(w => w.trim())
      .filter(Boolean);

  const stopwords = new Set([
    'de', 'y', 'en', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'para', 
    'por', 'del', 'al', 'todo', 'tipo', 'su', 'que', 'es', 'o', 'a', 'e'
  ]);

  // Combinar keywords de IA con palabras del perfil
  const rawFromAI = aiKeywords.flatMap(k => extractWords(String(k)));
  const profileWords = profileFields
    .filter(Boolean)
    .flatMap(field => extractWords(field));

  const allWords = Array.from(new Set([...rawFromAI, ...profileWords]))
    .map(k => k.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .filter(w => w.length > 2 && !/^\d+$/.test(w) && !stopwords.has(w));

  return allWords.slice(0, 12);
}

/**
 * Extrae keywords simples del mensaje (fallback)
 */
function extractSimpleKeywords(message) {
  const words = (String(message) || '').match(/\p{L}+/gu) || [];
  return words
    .slice(0, 8)
    .map(k => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
}

/**
 * Construye objeto de perfil
 */
function buildProfileObject(descripcion, necesidad, interesPrincipal, tipoAsistente) {
  return {
    descripcion: descripcion || null,
    necesidad: necesidad || null,
    interesPrincipal: interesPrincipal || null,
    tipoAsistente: tipoAsistente || null,
  };
}