import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
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

/**
 * Función HTTP para validar si un correo ya está registrado en un evento
 * Uso: POST /checkEmailAvailability
 * Body: { "email": "user@example.com", "eventId": "xxx", "currentUserId": "yyy" }
 */
export const checkEmailAvailability = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
  },
  async (req, res) => {
    // CORS headers
    const origin = req.headers.origin || "*";
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Credentials": "true",
    });

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send({ error: "Method not allowed" });
      return;
    }

    const { email, eventId, currentUserId } = req.body;

    if (!email || !eventId) {
      res.status(400).send({ 
        error: "Missing required fields: email and eventId" 
      });
      return;
    }

    const db = getFirestore();

    try {
      // Normalizar email
      const normalizedEmail = String(email).toLowerCase().trim();

      // Buscar usuarios con ese correo en el evento
      const usersRef = db.collection("users");
      const q = usersRef
        .where("correo", "==", normalizedEmail)
        .where("eventId", "==", eventId);

      const querySnapshot = await q.get();

      if (querySnapshot.empty) {
        // Email disponible
        res.status(200).send({
          available: true,
          message: "Email is available for this event",
        });
        return;
      }

      // Verificar si algún documento es de otro usuario
      const duplicateFound = querySnapshot.docs.some((doc) => {
        return doc.id !== currentUserId;
      });

      if (duplicateFound) {
        // Email ya está en uso por otro usuario
        res.status(200).send({
          available: false,
          message: "Email is already registered for this event",
        });
      } else {
        // Email pertenece al usuario actual
        res.status(200).send({
          available: true,
          message: "Email belongs to current user",
        });
      }

    } catch (error) {
      console.error("Error checking email availability:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  }
);

/**
 * Función HTTP para mejorar la descripción de un usuario usando IA
 * Genera una descripción profesional optimizada para matching
 * 
 * Uso: POST /improveUserDescription
 * Body: {
 *   "tipoAsistente": "comprador",
 *   "interesPrincipal": "Conocer proveedores",
 *   "necesidad": "Equipos de cómputo",
 *   "cargo": "Gerente de compras",
 *   "empresa": "Tech Solutions",
 *   "currentDescription": "Busco productos" // Opcional
 * }
 */
export const improveUserDescription = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    secrets: ["GEMINI_API_KEY", "GEMINI_API_URL", "DEFAULT_AI_MODEL"],
  },
  async (req, res) => {
    // CORS headers
    const origin = req.headers.origin || "*";
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Credentials": "true",
    });

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send({ error: "Method not allowed" });
      return;
    }

    const {
      tipoAsistente,
      interesPrincipal,
      necesidad,
      cargo,
      empresa,
      currentDescription,
    } = req.body;

    if (!tipoAsistente) {
      res.status(400).send({ error: "Missing required field: tipoAsistente" });
      return;
    }

    try {
      // Construir prompt para generar descripción optimizada
      const prompt = `Eres un experto en networking empresarial y redacción de perfiles profesionales. Tu tarea es crear una descripción profesional y concisa para un perfil de asistente a un evento de negocios.

INFORMACIÓN DEL USUARIO:
- Tipo de asistente: ${tipoAsistente || "No especificado"}
- Cargo: ${cargo || "No especificado"}
- Empresa: ${empresa || "No especificado"}
- Interés principal: ${interesPrincipal || "No especificado"}
- Necesidad: ${necesidad || "No especificado"}
${currentDescription ? `- Descripción actual: ${currentDescription}` : ""}

INSTRUCCIONES:
1. Crea una descripción profesional de 2-3 párrafos (máximo 300 palabras)
2. Enfócate en:
   - Qué busca el asistente en el evento
   - Qué puede ofrecer a otros asistentes
   - Áreas de interés específicas
   - Objetivos de networking
3. Usa lenguaje profesional pero accesible
4. Incluye palabras clave relevantes para facilitar el matching
5. Si es COMPRADOR: enfatiza qué productos/servicios busca
6. Si es VENDEDOR: enfatiza qué productos/servicios ofrece
7. Sé específico y concreto, evita generalidades

IMPORTANTE:
- NO uses formato markdown, HTML o caracteres especiales
- NO uses asteriscos, guiones o viñetas
- Escribe en texto plano, párrafos separados por saltos de línea
- Máximo 500 caracteres
- Lenguaje: Español

Devuelve ÚNICAMENTE el texto de la descripción mejorada, sin explicaciones adicionales.`;

      console.log("Generating improved description for:", tipoAsistente, cargo, empresa);

      const response = await callGeminiAPI(prompt, 0.7, 500, "text/plain");

      // Extraer el texto de la respuesta
      let improvedDescription = "";
      
      if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        improvedDescription = response.candidates[0].content.parts[0].text;
      } else if (typeof response === "string") {
        improvedDescription = response;
      } else {
        throw new Error("Invalid response format from Gemini API");
      }
      
      // Limpiar la respuesta
      improvedDescription = improvedDescription.trim();
      
      // Remover markdown si quedó algo
      improvedDescription = improvedDescription
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/`/g, "");

      console.log("Description improved successfully");

      res.status(200).send({
        success: true,
        description: improvedDescription,
        originalLength: currentDescription?.length || 0,
        improvedLength: improvedDescription.length,
      });

    } catch (error) {
      console.error("Error improving description:", error);
      res.status(500).send({
        error: "Failed to improve description",
        details: error.message,
      });
    }
  }
);

// HTTP AI proxy mejorado: recibe { userId, eventId, message }
// HTTP AI proxy mejorado: recibe { userId, eventId, message }
// HTTP AI proxy mejorado: recibe { userId, eventId, message }
// HTTP AI proxy mejorado: recibe { userId, eventId, message }
// ============================================================================
// FUNCIÓN MODIFICADA CON BÚSQUEDA POR EMBEDDINGS

/**
 * NUEVA FUNCIÓN: Genera embedding del texto usando Gemini
 */
async function generateEmbedding(text) {
  try {
    // Usando la API de embeddings de Gemini
    const model = "gemini-embedding-001"; // Modelo actualizado
    const apiUrl = GEMINI_API_URL.value();
    const apiKey = GEMINI_API_KEY.value();
    
    const response = await fetch(
      `${apiUrl}/models/${model}:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: {
            parts: [{ text }],
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Embedding API error:", errorText);
      throw new Error(`Embedding API failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.embedding || !data.embedding.values) {
      console.error("Invalid embedding response:", data);
      throw new Error("No embedding returned from API");
    }
    
    return data.embedding.values; // Array de números (vector)
  } catch (err) {
    console.error("Error generating embedding:", err);
    throw err;
  }
}

/**
 * NUEVA FUNCIÓN: Calcula similitud coseno entre dos vectores
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (normA * normB);
}

/**
 * NUEVA FUNCIÓN: Búsqueda por similitud de vectores
 * @param {Array} queryVector - Vector del query del usuario
 * @param {Array} documents - Array de documentos con campo 'vector'
 * @param {number} topK - Número de resultados a retornar
 * @param {number} threshold - Umbral mínimo de similitud (0-1)
 */
function searchByVectorSimilarity(queryVector, documents, topK = 10, threshold = 0.65) {
  const results = documents
    .filter(doc => doc.vector && Array.isArray(doc.vector))
    .map(doc => {
      const similarity = cosineSimilarity(queryVector, doc.vector);
      return {
        ...doc,
        similarity,
      };
    })
    .filter(doc => doc.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  console.log(`Vector search: ${documents.length} docs, ${results.length} above threshold ${threshold}`);
  if (results.length > 0) {
    console.log(`Top result similarity: ${results[0].similarity.toFixed(3)}, Lowest: ${results[results.length - 1].similarity.toFixed(3)}`);
  }
  return results;
}

/**
 * NUEVA FUNCIÓN: Combina búsqueda por keywords Y vectores
 * Útil para hacer búsquedas híbridas que aprovechan ambos métodos
 */
function hybridSearch(queryVector, documents, keywords, topK = 10) {
  // Primero obtener resultados por vector con threshold más alto
  const vectorResults = searchByVectorSimilarity(queryVector, documents, topK * 2, 0.65);
  
  console.log(`Hybrid search: ${vectorResults.length} vector results, keywords: ${keywords.join(', ')}`);
  
  // Aplicar boost por keywords
  const scoredResults = vectorResults.map(doc => {
    let keywordScore = 0;
    let keywordMatches = [];
    
    const searchableText = [
      doc.nombre,
      doc.empresa,
      doc.company_razonSocial,
      doc.descripcion,
      doc.interesPrincipal,
      doc.necesidad,
      doc.title,
      doc.description,
      doc.category,
      doc.razonSocial,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    keywords.forEach(kw => {
      const kwLower = kw.toLowerCase();
      if (searchableText.includes(kwLower)) {
        keywordScore += 0.2; // Boost de 0.2 por cada keyword
        keywordMatches.push(kw);
      }
    });

    const hybridScore = doc.similarity + keywordScore;
    
    if (keywordScore > 0) {
      console.log(`Doc ${doc.id || doc.nombre || doc.title}: similarity=${doc.similarity.toFixed(3)}, keywordBoost=${keywordScore.toFixed(3)} (${keywordMatches.join(', ')}), hybrid=${hybridScore.toFixed(3)}`);
    }

    return {
      ...doc,
      hybridScore,
      keywordMatches: keywordMatches.length,
    };
  });

  // Filtrar resultados que tengan buena similitud O keywords
  // Esto asegura que solo devolvemos resultados relevantes
  const filteredResults = scoredResults.filter(doc => {
    // Si tiene alta similitud de vector (>0.4), incluirlo
    if (doc.similarity >= 0.4) return true;
    
    // Si tiene similitud media (>0.3) Y al menos una keyword, incluirlo
    if (doc.similarity >= 0.3 && doc.keywordMatches > 0) return true;
    
    // Si tiene múltiples keywords (>1), incluirlo aunque la similitud sea menor
    if (doc.keywordMatches > 1) return true;
    
    return false;
  });

  const finalResults = filteredResults
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, topK);
    
  console.log(`Hybrid search final: ${finalResults.length} results (filtered from ${scoredResults.length})`);
  return finalResults;
}

export const aiProxy = onRequest(
  { 
    region: "us-central1", 
    memory: "512MiB", 
    secrets: ["GEMINI_API_KEY", "GEMINI_API_URL", "DEFAULT_AI_MODEL"],
  },
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
      
      const db = getFirestore();
      
      // Derivar eventId si es necesario
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

IMPORTANTE para keywords:
- Extrae SOLO las palabras clave más relevantes y específicas del mensaje
- Para búsquedas de productos, incluye el nombre exacto del producto y términos relacionados
- Evita palabras genéricas como "busco", "necesito", "quiero"
- Incluye sinónimos y términos relacionados cuando sea relevante
- Ejemplo: "busco sillas de oficina" → keywords: ["sillas", "silla", "oficina", "mobiliario", "muebles"]

Devuelve ÚNICAMENTE un objeto JSON con esta estructura:
{
  "intent": "search_query | general_question | greeting | meeting_related",
  "confidence": 0.0-1.0,
  "keywords": ["palabra1", "palabra2", "sinonimo1"],
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

      // Caso 2: Pregunta general
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
      // PASO 3: BÚSQUEDA POR EMBEDDINGS Y KEYWORDS (HÍBRIDA)
      // ========================================================================

      // Refinar keywords SIN incluir perfil del usuario (evita contaminar resultados)
      let keywords = cleanAndNormalizeKeywords(
        intentAnalysis.keywords || [],
        [] // no mezclar perfil — el perfil se usa solo en el ranking AI (paso 4)
      );
      
      // Fallback: si AI no extrajo keywords útiles, usar palabras del mensaje original
      if (keywords.length === 0) {
        keywords = extractSimpleKeywords(message);
        console.log("Fallback to simple keywords from message:", keywords);
      }
      
      const scopes = intentAnalysis.scopes && intentAnalysis.scopes.length > 0 
        ? intentAnalysis.scopes 
        : ["assistants", "products", "companies"];

      console.log("Refined search - scopes:", scopes, "keywords:", keywords);

      // Cargar políticas del evento para respetar roleMode / discoveryMode
      let eventPolicies = { roleMode: "open", discoveryMode: "all" };
      if (eventId) {
        try {
          const eventDoc = await db.collection("events").doc(eventId).get();
          if (eventDoc.exists) {
            const cfg = eventDoc.data()?.config?.policies;
            if (cfg) {
              eventPolicies = { ...eventPolicies, ...cfg };
            }
          }
        } catch (err) {
          console.warn("Could not load event policies, using defaults", err);
        }
      }
      console.log("Event policies:", eventPolicies.roleMode, eventPolicies.discoveryMode);

      // *** GENERAR EMBEDDING DEL MENSAJE DEL USUARIO ***
      let queryVector = null;
      try {
        // Combinar mensaje con perfil para mejor contexto en el embedding
        const searchContext = `${message}${profileText}`;
        queryVector = await generateEmbedding(searchContext);
        console.log("Query vector generated, dimension:", queryVector.length);
      } catch (embErr) {
        console.warn("Failed to generate embedding, falling back to keyword search:", embErr);
        // Continuar sin vector (fallback a búsqueda por keywords)
      }

      // Lógica de inversión de tipo: solo si roleMode=buyer_seller o discoveryMode=by_role
      const userTipo = tipoAsistente ? String(tipoAsistente).toLowerCase() : null;
      let desiredOpposite = null;
      const shouldFilterByRole =
        eventPolicies.roleMode === "buyer_seller" || eventPolicies.discoveryMode === "by_role";
      
      if (shouldFilterByRole && userTipo) {
        if (userTipo === "vendedor") desiredOpposite = "comprador";
        else if (userTipo === "comprador") desiredOpposite = "vendedor";
      }

      const results = { 
        assistants: [], 
        products: [], 
        companies: [], 
        meetings: [] 
      };

      // Helper para matching (normaliza acentos para match consistente)
      const normalizeForMatch = (s) =>
        String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      
      const matchesAny = (obj, fields) => {
        const text = fields.map((f) => normalizeForMatch(obj[f])).join(" ");
        return keywords.some((kw) => text.includes(kw));
      };

      // Precargar asistentes del evento (una sola query, reutilizada por companies)
      let allEventUsers = [];
      const needsUsers = scopes.includes("assistants") || scopes.includes("companies");
      if (needsUsers && eventId) {
        try {
          const usersSnap = await db.collection("users").where("eventId", "==", eventId).get();
          allEventUsers = usersSnap.docs
            .filter((d) => d.id !== userId)
            .map((d) => ({ id: d.id, ...d.data() }));
          console.log(`Preloaded ${allEventUsers.length} event users`);
        } catch (err) {
          console.warn("Users preload failed", err);
        }
      }

      // Precargar reuniones del usuario (optimizado con batch get de usuarios)
      let userMeetingParticipants = new Set();
      let allUserMeetings = [];
      if ((scopes.includes("assistants") || scopes.includes("meetings")) && eventId) {
        try {
          const meetingsSnap = await db.collection("events")
            .doc(eventId)
            .collection("meetings")
            .where("participants", "array-contains", userId)
            .get();
          
          console.log(`Preloaded ${meetingsSnap.size} meetings for user`);
          
          // Recolectar todos los IDs de usuarios únicos de las reuniones
          const counterpartIds = new Set();
          const meetingsData = [];
          
          meetingsSnap.forEach(doc => {
            const meeting = doc.data();
            meetingsData.push({ id: doc.id, ...meeting });
            
            // Para filtro de asistentes: solo excluir si está pendiente o aceptada
            if (meeting.status === "pending" || meeting.status === "accepted") {
              meeting.participants?.forEach(participantId => {
                if (participantId !== userId) {
                  userMeetingParticipants.add(participantId);
                }
              });
            }
            
            // Para enriquecer meetings: obtener counterpart
            const counterpartId = meeting.requesterId === userId 
              ? meeting.receiverId 
              : meeting.requesterId;
            
            if (counterpartId) {
              counterpartIds.add(counterpartId);
            }
          });
          
          console.log(`User has ${userMeetingParticipants.size} existing meeting participants to exclude`);
          
          // Batch get de todos los counterparts (mucho más eficiente que N queries)
          const counterpartMap = new Map();
          if (counterpartIds.size > 0) {
            const counterpartIdsArray = Array.from(counterpartIds);
            
            // Firestore batch get (máximo 10 por batch)
            const batchSize = 10;
            for (let i = 0; i < counterpartIdsArray.length; i += batchSize) {
              const batch = counterpartIdsArray.slice(i, i + batchSize);
              const userDocs = await Promise.all(
                batch.map(id => db.collection("users").doc(id).get())
              );
              
              userDocs.forEach(doc => {
                if (doc.exists) {
                  const data = doc.data();
                  counterpartMap.set(doc.id, {
                    id: doc.id,
                    nombre: data.nombre || "Sin nombre",
                    empresa: data.empresa || data.company_razonSocial || "Sin empresa",
                    tipoAsistente: data.tipoAsistente || null,
                    descripcion: data.descripcion || null,
                    photoURL: data.photoURL || null,
                  });
                }
              });
            }
            
            console.log(`Batch loaded ${counterpartMap.size} counterpart users`);
          }
          
          // Guardar meetings con counterpart info ya cargada
          allUserMeetings = meetingsData.map(meeting => ({
            ...meeting,
            counterpartInfo: counterpartMap.get(
              meeting.requesterId === userId ? meeting.receiverId : meeting.requesterId
            ) || null
          }));
          
        } catch (err) {
          console.warn("Failed to preload meetings", err);
        }
      }

      // *** BUSCAR ASISTENTES CON VECTOR SIMILARITY O KEYWORDS ***
      if (scopes.includes("assistants")) {
        // Filtrar por tipo opuesto si aplica
        let filteredUsers = allEventUsers;
        if (desiredOpposite) {
          filteredUsers = allEventUsers.filter(u => {
            const otherType = (u.tipoAsistente || "").toString().toLowerCase();
            return otherType === desiredOpposite;
          });
          console.log(`Filtered users by role: ${filteredUsers.length} (looking for ${desiredOpposite})`);
        }

        // Excluir usuarios con reuniones existentes (pendientes o aceptadas)
        filteredUsers = filteredUsers.filter(u => !userMeetingParticipants.has(u.id));
        console.log(`After excluding existing meetings: ${filteredUsers.length} users`);

        // Usar búsqueda híbrida si hay vector, sino keywords
        if (queryVector) {
          results.assistants = hybridSearch(queryVector, filteredUsers, keywords, 20);
          console.log(`Found ${results.assistants.length} assistants via hybrid search`);
        } else {
          // Fallback a búsqueda por keywords
          results.assistants = filteredUsers.filter(u =>
            matchesAny(u, [
              "nombre",
              "empresa",
              "company_razonSocial",
              "descripcion",
              "interesPrincipal",
              "necesidad",
            ])
          );
          console.log(`Found ${results.assistants.length} assistants via keyword search`);
        }
      }

      // *** BUSCAR PRODUCTOS CON VECTOR SIMILARITY O KEYWORDS ***
      if (scopes.includes("products")) {
        try {
          if (eventId) {
            const productsSnap = await db.collection("events")
              .doc(eventId)
              .collection("products")
              .get();
            
            // Filtrar productos que no pertenezcan al usuario actual
            const allProducts = productsSnap.docs
              .map(d => ({ 
                id: d.id, 
                ...d.data() 
              }))
              .filter(p => p.ownerUserId !== userId); // Excluir productos propios

            console.log(`Products: ${productsSnap.docs.length} total, ${allProducts.length} after filtering own products`);

            if (queryVector) {
              results.products = hybridSearch(queryVector, allProducts, keywords, 20);
              console.log(`Found ${results.products.length} products via hybrid search`);
            } else {
              // Fallback a keywords
              results.products = allProducts.filter(p =>
                matchesAny(p, ["title", "description", "category"])
              );
              console.log(`Found ${results.products.length} products via keyword search`);
            }
          }
        } catch (err) {
          console.warn("Products query failed", err);
        }
      }

      // *** BUSCAR EMPRESAS CON VECTOR SIMILARITY O KEYWORDS ***
      // Reutiliza allEventUsers para evitar N+1 queries
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
              const allCompanies = [];
              
              for (const d of companiesSnap.docs) {
                const companyData = { id: d.id, ...d.data() };
                
                // Reutilizar allEventUsers en vez de query por empresa (optimización)
                const companyAssistants = companyData.nitNorm
                  ? allEventUsers.filter((u) => u.company_nit === companyData.nitNorm)
                  : [];
                
                companyData.assistants = companyAssistants;
                allCompanies.push(companyData);
              }

              console.log(`Loaded ${allCompanies.length} companies`);

              if (queryVector) {
                results.companies = hybridSearch(queryVector, allCompanies, keywords, 15);
                console.log(`Found ${results.companies.length} companies via hybrid search`);
              } else {
                // Fallback a keywords
                results.companies = allCompanies.filter(c =>
                  matchesAny(c, ["razonSocial", "descripcion"])
                );
                console.log(`Found ${results.companies.length} companies via keyword search`);
              }
            }
          }
        } catch (err) {
          console.warn("Companies query failed", err);
        }
      }

      // *** BUSCAR REUNIONES (optimizado - usa datos precargados) ***
      if (scopes.includes("meetings")) {
        try {
          if (eventId && allUserMeetings.length > 0) {
            console.log(`Processing ${allUserMeetings.length} preloaded meetings`);
            
            for (const meeting of allUserMeetings) {
              const enrichedMeeting = {
                id: meeting.id,
                status: meeting.status,
                createdAt: meeting.createdAt,
                updatedAt: meeting.updatedAt || null,
                requesterId: meeting.requesterId,
                receiverId: meeting.receiverId,
                participants: meeting.participants || [],
                counterpart: meeting.counterpartInfo,
                isRequester: meeting.requesterId === userId,
              };

              if (meeting.status === "accepted") {
                enrichedMeeting.meetingDate = meeting.meetingDate || null;
                enrichedMeeting.timeSlot = meeting.timeSlot || null;
                enrichedMeeting.startMinutes = meeting.startMinutes || null;
                enrichedMeeting.endMinutes = meeting.endMinutes || null;
                enrichedMeeting.tableAssigned = meeting.tableAssigned || null;
                enrichedMeeting.slotId = meeting.slotId || null;
              }

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

              if (hasMeetingKeyword || keywords.length === 0) {
                results.meetings.push(enrichedMeeting);
              } else if (keywords.length > 0) {
                const meetingText = [
                  meeting.status,
                  meeting.counterpartInfo?.nombre,
                  meeting.counterpartInfo?.empresa,
                  meeting.counterpartInfo?.descripcion,
                  meeting.meetingDate,
                  meeting.timeSlot,
                ].filter(Boolean).join(" ").toLowerCase();

                const hasMatch = keywords.some(kw => meetingText.includes(kw));
                if (hasMatch) {
                  results.meetings.push(enrichedMeeting);
                }
              }
            }
            
            console.log(`Meetings after filtering: ${results.meetings.length}`);
          }
        } catch (err) {
          console.warn("Meetings processing failed", err);
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
        // Agregar métricas de búsqueda por embeddings
        searchMetrics: {
          usedEmbeddings: queryVector !== null,
          vectorDimension: queryVector ? queryVector.length : null,
        },
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
    nombre: a.nombre,
    empresa: a.empresa || a.company_razonSocial,
    descripcion: a.descripcion,
    necesidad: a.necesidad,
    interesPrincipal: a.interesPrincipal,
    tipoAsistente: a.tipoAsistente,
  }));

  const productsSummary = results.products.slice(0, 20).map(p => ({
    title: p.title,
    description: p.description,
    category: p.category,
  }));

  const companiesSummary = results.companies.slice(0, 20).map(c => ({
    razonSocial: c.razonSocial,
    descripcion: c.descripcion,
    assistantsCount: c.assistants?.length || 0,
  }));

  const meetingsSummary = results.meetings.slice(0, 10).map(m => ({
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

CRITERIOS DE RELEVANCIA ESTRICTOS:
- SOLO menciona resultados que estén DIRECTAMENTE relacionados con la búsqueda del usuario
- Si el usuario busca "sillas", menciona sillas, escritorios, mobiliario de oficina (relacionado), pero NO colchones o productos no relacionados
- Prioriza resultados que contengan las palabras clave exactas o términos muy similares
- Si un resultado no es relevante, NO lo menciones en tu respuesta
- Es mejor mencionar pocos resultados muy relevantes que muchos resultados poco relacionados

TAREA:
1. Analiza la compatibilidad de cada resultado con la consulta del usuario
2. FILTRA y menciona SOLO los resultados DIRECTAMENTE relevantes (alta compatibilidad)
3. Para reuniones: indica claramente el estado (pendiente/aceptada/rechazada) y con quién es
4. Identifica los 3-5 resultados MÁS compatibles y explica por qué son relevantes
5. Da recomendaciones prácticas al usuario basadas SOLO en resultados relevantes

IMPORTANTE: En tu respuesta, menciona los resultados por su NOMBRE o TÍTULO, NO por ID. Por ejemplo:
- Para asistentes: usa el campo "nombre"
- Para productos: usa el campo "title"
- Para empresas: usa el campo "razonSocial"
- Para reuniones: usa el nombre del counterpart

Devuelve un JSON con esta estructura:
{
  "message": "Respuesta natural y profesional al usuario (máximo 250 palabras). Menciona específicamente SOLO los resultados MÁS RELEVANTES POR NOMBRE/TÍTULO y por qué son útiles. NO menciones resultados poco relacionados. NO uses IDs.",
  "rankings": {
    "assistants": ["nombre1", "nombre2", "nombre3"],
    "products": ["titulo1", "titulo2"],
    "companies": ["razonSocial1", "razonSocial2"],
    "meetings": ["nombreCounterpart1"]
  },
  "insights": "Breve insight sobre los patrones encontrados en los resultados RELEVANTES"
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
 * Reordena un array según un ranking de nombres/títulos
 */
function reorderByRanking(items, rankedNames) {
  if (!rankedNames || rankedNames.length === 0) return items;
  
  const ranked = [];
  const unranked = [];

  // Función helper para obtener el identificador del item
  const getItemName = (item) => {
    return item.nombre || item.title || item.razonSocial || item.counterpart?.nombre || null;
  };

  // Primero agregar los items en el orden del ranking
  rankedNames.forEach(name => {
    const item = items.find(i => {
      const itemName = getItemName(i);
      return itemName && itemName.toLowerCase().trim() === name.toLowerCase().trim();
    });
    if (item) ranked.push(item);
  });

  // Luego agregar los que no están en el ranking
  items.forEach(item => {
    const itemName = getItemName(item);
    const isRanked = rankedNames.some(name => 
      itemName && itemName.toLowerCase().trim() === name.toLowerCase().trim()
    );
    if (!isRanked) {
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

async function getEmbedding(text, apiKey, apiUrl, model) {
  if (!text.trim()) {
    console.log("Skipping empty text for embedding");
    return null;
  }

  try {
    const url = `${apiUrl}/models/${model}:embedContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text }]
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error: ${errorText}`);
    }

    const data = await response.json();
    return data.embedding.values; // Asumiendo estructura estándar de Gemini embeddings
  } catch (err) {
    console.error("Error generating embedding:", err);
    return null;
  }
}

/**
 * Búsqueda por vectores pura
 * Endpoint: /vectorSearch
 * Parámetros:
 * - text: texto a buscar (required)
 * - category: "assistants" | "products" | "companies" (required)
 * - eventId: ID del evento (required)
 * - userId: ID del usuario que hace la búsqueda (optional, para filtros)
 * - limit: número máximo de resultados (optional, default: 10)
 * - threshold: umbral mínimo de similitud 0-1 (optional, default: 0.35)
 */
export const vectorSearch = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    secrets: ["GEMINI_API_KEY", "GEMINI_API_URL"],
  },
  async (req, res) => {
    // Set CORS headers
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
      const text = body.text;
      const category = body.category;
      const eventId = body.eventId;
      const userId = body.userId || null;
      const limit = body.limit || 10;
      const threshold = body.threshold || 0.35;

      // Validación de parámetros
      if (!text || !category || !eventId) {
        res.status(400).send({ 
          error: "Missing required parameters: text, category, eventId" 
        });
        return;
      }

      if (!["assistants", "products", "companies"].includes(category)) {
        res.status(400).send({ 
          error: "Invalid category. Must be: assistants, products, or companies" 
        });
        return;
      }

      console.log(`Vector search: category=${category}, eventId=${eventId}, text="${text.substring(0, 50)}..."`);

      const db = getFirestore();

      // Generar embedding del texto
      let queryVector = null;
      try {
        queryVector = await generateEmbedding(text);
        console.log(`Query vector generated, dimension: ${queryVector.length}`);
      } catch (embErr) {
        console.error("Failed to generate embedding:", embErr);
        res.status(500).send({ 
          error: "Failed to generate embedding", 
          details: embErr.message 
        });
        return;
      }

      let results = [];

      // Búsqueda según categoría
      if (category === "assistants") {
        try {
          const usersSnap = await db.collection("users")
            .where("eventId", "==", eventId)
            .get();

          const allUsers = usersSnap.docs
            .filter(d => !userId || d.id !== userId) // Excluir usuario actual si se proporciona
            .map(d => ({ id: d.id, ...d.data() }));

          console.log(`Loaded ${allUsers.length} users for vector search`);

          results = searchByVectorSimilarity(queryVector, allUsers, limit, threshold);
          
          // Devolver todos los campos necesarios
          results = results.map(user => ({
            id: user.id,
            nombre: user.nombre,
            empresa: user.empresa || user.company_razonSocial,
            cargo: user.cargo,
            telefono: user.telefono,
            correo: user.correo,
            cedula: user.cedula,
            descripcion: user.descripcion,
            necesidad: user.necesidad,
            interesPrincipal: user.interesPrincipal,
            tipoAsistente: user.tipoAsistente,
            photoURL: user.photoURL || null,
            company_nit: user.company_nit,
            company_razonSocial: user.company_razonSocial,
            companyId: user.companyId,
            nitNorm: user.nitNorm,
            eventId: user.eventId,
            lastLogin: user.lastLogin,
            similarity: user.similarity,
          }));

        } catch (err) {
          console.error("Assistants search failed:", err);
          res.status(500).send({ error: "Assistants search failed", details: err.message });
          return;
        }
      }

      if (category === "products") {
        try {
          const productsSnap = await db.collection("events")
            .doc(eventId)
            .collection("products")
            .get();

          const allProducts = productsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(p => !userId || p.ownerUserId !== userId); // Excluir productos propios

          console.log(`Loaded ${allProducts.length} products for vector search`);

          results = searchByVectorSimilarity(queryVector, allProducts, limit, threshold);
          
          // Formatear resultados
          results = results.map(product => ({
            id: product.id,
            title: product.title,
            description: product.description,
            category: product.category,
            ownerUserId: product.ownerUserId,
            imageUrl: product.imageUrl || null,
            similarity: product.similarity,
          }));

        } catch (err) {
          console.error("Products search failed:", err);
          res.status(500).send({ error: "Products search failed", details: err.message });
          return;
        }
      }

      if (category === "companies") {
        try {
          const companiesSnap = await db.collection("events")
            .doc(eventId)
            .collection("companies")
            .get();

          const allCompanies = companiesSnap.docs.map(d => ({ 
            id: d.id, 
            ...d.data() 
          }));

          console.log(`Loaded ${allCompanies.length} companies for vector search`);

          results = searchByVectorSimilarity(queryVector, allCompanies, limit, threshold);
          
          // Formatear resultados
          results = results.map(company => ({
            id: company.id,
            razonSocial: company.razonSocial,
            descripcion: company.descripcion,
            nitNorm: company.nitNorm,
            similarity: company.similarity,
          }));

        } catch (err) {
          console.error("Companies search failed:", err);
          res.status(500).send({ error: "Companies search failed", details: err.message });
          return;
        }
      }

      console.log(`Vector search complete: ${results.length} results found`);

      res.status(200).send({
        category,
        query: text,
        threshold,
        limit,
        count: results.length,
        results,
      });

    } catch (err) {
      console.error("vectorSearch error:", err);
      res.status(500).send({ error: "internal_error", details: err.message });
    }
  }
);

export const vectorizeDocuments = onRequest(
  {
    secrets: ["GEMINI_API_KEY", "GEMINI_API_URL"],
    memory: "512MiB", // Aumentar memoria si hay muchos documentos
    timeoutSeconds: 300, // Tiempo máximo para procesar
    region: "us-central1"
  },
  async (req, res) => {
    const eventId = req.query.eventId;

    if (!eventId) {
      console.log("Missing eventId");
      return res.status(400).send("Missing eventId query parameter");
    }

    const db = getFirestore();
    const apiKey = GEMINI_API_KEY.value();
    const apiUrl = GEMINI_API_URL.value();
    const model = "gemini-embedding-001"; // Modelo de embeddings actualizado

    if (!apiKey || !apiUrl || !model) {
      console.log("Missing secrets");
      return res.status(500).send("Missing required secrets");
    }

    try {
      console.log(`Starting vectorization for eventId: ${eventId}`);

      // Procesar Users (assistants)
      const usersSnap = await db.collection("users").where("eventId", "==", eventId).get();
      console.log(`Found ${usersSnap.size} users to vectorize`);

      const userPromises = usersSnap.docs.map(async (doc) => {
        const data = doc.data();
        const text = [
          data.nombre,
          data.empresa,
          data.company_razonSocial,
          data.descripcion,
          data.interesPrincipal,
          data.necesidad
        ].filter(Boolean).join(" ");

        const vector = await getEmbedding(text, apiKey, apiUrl, model);
        if (vector) {
          await doc.ref.update({ vector });
          console.log(`Updated user ${doc.id} with vector`);
        }
      });
      await Promise.all(userPromises);

      // Procesar Products
      const productsSnap = await db.collection("events").doc(eventId).collection("products").get();
      console.log(`Found ${productsSnap.size} products to vectorize`);

      const productPromises = productsSnap.docs.map(async (doc) => {
        const data = doc.data();
        const text = [data.title, data.description, data.category].filter(Boolean).join(" ");

        const vector = await getEmbedding(text, apiKey, apiUrl, model);
        if (vector) {
          await doc.ref.update({ vector });
          console.log(`Updated product ${doc.id} with vector`);
        }
      });
      await Promise.all(productPromises);

      // Procesar Companies
      const companiesSnap = await db.collection("events").doc(eventId).collection("companies").get();
      console.log(`Found ${companiesSnap.size} companies to vectorize`);

      const companyPromises = companiesSnap.docs.map(async (doc) => {
        const data = doc.data();
        const text = [data.razonSocial, data.descripcion].filter(Boolean).join(" ");

        const vector = await getEmbedding(text, apiKey, apiUrl, model);
        if (vector) {
          await doc.ref.update({ vector });
          console.log(`Updated company ${doc.id} with vector`);
        }
      });
      await Promise.all(companyPromises);

      // Procesar Meetings (enriquecido con info de participantes)
      const meetingsSnap = await db.collection("events").doc(eventId).collection("meetings").get();
      console.log(`Found ${meetingsSnap.size} meetings to vectorize`);

      const meetingPromises = meetingsSnap.docs.map(async (doc) => {
        const meetingData = doc.data();
        let texts = [
          meetingData.status,
          meetingData.timeSlot,
          meetingData.meetingDate
        ];

        // Fetch y agregar info de participantes
        for (const uid of meetingData.participants || []) {
          const userDoc = await db.collection("users").doc(uid).get();
          if (userDoc.exists) {
            const u = userDoc.data();
            texts.push(
              u.nombre,
              u.empresa,
              u.company_razonSocial,
              u.descripcion
            );
          } else {
            console.warn(`User ${uid} not found for meeting ${doc.id}`);
          }
        }

        const text = texts.filter(Boolean).join(" ");

        const vector = await getEmbedding(text, apiKey, apiUrl, model);
        if (vector) {
          await doc.ref.update({ vector });
          console.log(`Updated meeting ${doc.id} with vector`);
        }
      });
      await Promise.all(meetingPromises);

      console.log("Vectorization complete");
      return res.status(200).send(`Vectorization complete for eventId: ${eventId}`);
    } catch (error) {
      console.error("Error during vectorization:", error);
      return res.status(500).send("Error during vectorization");
    }
  }
);


/**
 * Función helper para condensar información del usuario usando Gemini AI
 * Toma interesPrincipal, necesidad y descripcion y genera un texto optimizado para embeddings
 */
async function condenseUserInfoWithAI(userData) {
  try {
    const interesPrincipal = userData.interesPrincipal || "";
    const necesidad = userData.necesidad || "";
    const descripcion = userData.descripcion || "";
    
    // Si no hay información suficiente, retornar null
    if (!interesPrincipal && !necesidad && !descripcion) {
      console.warn(`User ${userData.nombre || "unknown"} has no relevant information`);
      return null;
    }
    
    // Construir el prompt para Gemini
    const prompt = `Eres un sistema de normalización semántica para embeddings.

Convierte la información del asistente en un perfil estructurado optimizado para similitud vectorial.

Reglas:
- Usa frases cortas.
- No uses conectores narrativos.
- Usa formato consistente.
- Prioriza sustantivos y conceptos clave.
- No inventes información.
- No uses texto decorativo.
- Máximo 60 palabras.

Formato obligatorio:

Industria: <lista corta separada por coma>
Sector: <lista corta separada por coma>

Información:
- Interés principal: ${interesPrincipal}
- Necesidad: ${necesidad}
- Descripción: ${descripcion}

Responde solo con el perfil estructurado.`;

    // Usar la API de Gemini directamente con fetch
    const response = await fetch(
      `${GEMINI_API_URL.value()}/models/${DEFAULT_AI_MODEL.value()}:generateContent?key=${GEMINI_API_KEY.value()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const condensedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    
    if (!condensedText) {
      throw new Error("No text generated by Gemini");
    }
    
    console.log(`Condensed text for user ${userData.nombre}: ${condensedText.substring(0, 100)}...`);
    
    return condensedText;
  } catch (error) {
    console.error("Error condensing user info with AI:", error);
    // Fallback: concatenar los campos directamente
    const fallbackText = [
      userData.interesPrincipal,
      userData.necesidad,
      userData.descripcion
    ].filter(Boolean).join(". ");
    
    return fallbackText || null;
  }
}

/**
 * Función helper para generar embedding de un usuario
 * USA interesPrincipal, necesidad y descripcion condensados por IA
 */
async function generateUserEmbedding(userData) {
  try {
    // Condensar información usando IA
    const condensedText = await condenseUserInfoWithAI(userData);
    
    if (!condensedText || condensedText.trim().length === 0) {
      console.warn(`User ${userData.nombre || "unknown"} has no information to embed`);
      return null;
    }
    
    // Generar embedding usando Gemini
    const embedding = await generateEmbedding(condensedText);
    
    // Retornar tanto el embedding como el texto condensado
    return {
      vector: embedding,
      condensedText: condensedText
    };
  } catch (error) {
    console.error("Error generating user embedding:", error);
    return null;
  }
}

/**
 * Función para calcular afinidad usando embeddings con boost para roles complementarios
 */
async function calculateAffinityWithEmbeddings(userA, userB, vectorA = null, vectorB = null) {
  try {
    // Generar embeddings si no se proporcionan
    let embeddingA = vectorA;
    let embeddingB = vectorB;
    
    if (!embeddingA) {
      const resultA = await generateUserEmbedding(userA);
      embeddingA = resultA?.vector || null;
    }
    
    if (!embeddingB) {
      const resultB = await generateUserEmbedding(userB);
      embeddingB = resultB?.vector || null;
    }
    
    if (!embeddingA || !embeddingB) {
      console.warn("Failed to generate embeddings, using fallback");
      return calculateAffinityScoreFallback(userA, userB);
    }
    
    // Calcular similitud coseno base
    const baseSimilarity = cosineSimilarity(embeddingA, embeddingB);
    
    // Aplicar boost por roles complementarios
    const tipoA = (userA.tipoAsistente || "").toLowerCase();
    const tipoB = (userB.tipoAsistente || "").toLowerCase();
    
    let roleBoost = 1;
    let roleReason = null;
    
    if ((tipoA === "comprador" && tipoB === "vendedor") || 
        (tipoA === "vendedor" && tipoB === "comprador")) {
      roleBoost = 1; // Boost de 25% para roles complementarios
      roleReason = "Roles complementarios (comprador-vendedor)";
    } else if (tipoA === tipoB && tipoA !== "") {
      roleBoost = 0.7 // Boost menor para mismo rol
      roleReason = `Mismo rol: ${tipoA}`;
    }
    
    // Score final = similitud base + boost (máximo 1.0)
    const finalScore = Math.min(1.0, baseSimilarity * roleBoost);
    
    // Convertir a escala 0-100
    const score = Math.round(finalScore * 100);
    
    // Generar razones basadas en la similitud
    const reasons = [];
    
    if (roleReason) {
      reasons.push(roleReason);
    }
    
    if (userA.interesPrincipal && userB.interesPrincipal && 
        userA.interesPrincipal === userB.interesPrincipal) {
      reasons.push("Mismo interés principal");
    }
    
    if (finalScore >= 0.8) {
      reasons.push("Alta compatibilidad de perfiles");
    } else if (finalScore >= 0.6) {
      reasons.push("Buena compatibilidad de perfiles");
    } else if (finalScore >= 0.4) {
      reasons.push("Compatibilidad moderada");
    }
    
    // Analizar keywords en común
    const extractKeywords = (text) => {
      if (!text) return [];
      return text.toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 10);
    };
    
    const keywordsA = extractKeywords(userA.necesidad || userA.descripcion || "");
    const textB = (userB.necesidad || userB.descripcion || "").toLowerCase();
    const matchingKeywords = keywordsA.filter(kw => textB.includes(kw));
    
    if (matchingKeywords.length > 0) {
      reasons.push(`${matchingKeywords.length} palabras clave coinciden`);
    }
    
    console.log(`Embedding Affinity: ${userA.nombre} <-> ${userB.nombre} = ${score}% (base: ${(baseSimilarity * 100).toFixed(1)}%, boost: ${(roleBoost * 100).toFixed(1)}%)`);
    
    return {
      score,
      reasons: reasons.slice(0, 5), // Máximo 5 razones
      aiGenerated: true,
      embeddingBased: true,
      baseSimilarity: Math.round(baseSimilarity * 100),
      roleBoost: Math.round(roleBoost * 100),
    };
    
  } catch (error) {
    console.error("Error calculating affinity with embeddings:", error);
    return calculateAffinityScoreFallback(userA, userB);
  }
}

/**
 * Función helper para calcular score de afinidad entre dos usuarios usando Gemini AI
 * DEPRECATED: Usar calculateAffinityWithEmbeddings en su lugar
 */
// async function calculateAffinityScoreWithAI(userA, userB) {
//   try {
//     // Preparar datos de los usuarios para el prompt
//     const userAProfile = {
//       nombre: userA.nombre || "Sin nombre",
//       empresa: userA.empresa || userA.company_razonSocial || "Sin empresa",
//       cargo: userA.cargo || "Sin cargo",
//       tipoAsistente: userA.tipoAsistente || "No especificado",
//       interesPrincipal: userA.interesPrincipal || "No especificado",
//       descripcion: userA.descripcion || "Sin descripción",
//       necesidad: userA.necesidad || "Sin necesidad especificada",
//     };

//     const userBProfile = {
//       nombre: userB.nombre || "Sin nombre",
//       empresa: userB.empresa || userB.company_razonSocial || "Sin empresa",
//       cargo: userB.cargo || "Sin cargo",
//       tipoAsistente: userB.tipoAsistente || "No especificado",
//       interesPrincipal: userB.interesPrincipal || "No especificado",
//       descripcion: userB.descripcion || "Sin descripción",
//       necesidad: userB.necesidad || "Sin necesidad especificada",
//     };

//     const prompt = `Eres un experto en networking empresarial y matchmaking para eventos de negocios. Tu tarea es analizar dos perfiles de asistentes y calcular su nivel de afinidad/compatibilidad para una reunión de networking.

// PERFIL A:
// - Nombre: ${userAProfile.nombre}
// - Empresa: ${userAProfile.empresa}
// - Cargo: ${userAProfile.cargo}
// - Tipo: ${userAProfile.tipoAsistente}
// - Interés principal: ${userAProfile.interesPrincipal}
// - Descripción: ${userAProfile.descripcion}
// - Necesidad: ${userAProfile.necesidad}

// PERFIL B:
// - Nombre: ${userBProfile.nombre}
// - Empresa: ${userBProfile.empresa}
// - Cargo: ${userBProfile.cargo}
// - Tipo: ${userBProfile.tipoAsistente}
// - Interés principal: ${userBProfile.interesPrincipal}
// - Descripción: ${userBProfile.descripcion}
// - Necesidad: ${userBProfile.necesidad}

// CRITERIOS DE EVALUACIÓN:
// 1. Roles complementarios (comprador-vendedor) en el campo Tipo: Alta prioridad
// 2. Compatibilidad de sectores/industrias: Alta prioridad
// 3. Coincidencia de intereses y necesidades: Media prioridad
// 4. Sinergia entre descripciones y necesidades: Media prioridad
// 5. Nivel jerárquico compatible: Baja prioridad

// IMPORTANTE:
// - Un score de 70+ indica alta compatibilidad (deberían reunirse)
// - Un score de 50-69 indica compatibilidad media (podrían beneficiarse)
// - Un score de 30-49 indica baja compatibilidad
// - Un score menor a 30 indica muy baja compatibilidad

// Devuelve ÚNICAMENTE un objeto JSON con esta estructura exacta:
// {
//   "score": número entre 0-100,
//   "reasons": ["razón 1", "razón 2", "razón 3"],
//   "reasoning": "explicación breve de por qué este score"
// }

// Las razones deben ser frases cortas y específicas (máximo 8 palabras cada una).`;

//     const response = await callGeminiAPI(prompt, 0.3, 5000, "application/json");
//     const result = parseAIResponse(response);

//     // Validar respuesta
//     if (!result || typeof result.score !== "number" || !Array.isArray(result.reasons)) {
//       console.warn("Invalid AI response, falling back to manual calculation");
//       return calculateAffinityScoreFallback(userA, userB);
//     }

//     // Asegurar que el score esté en rango válido
//     const score = Math.max(0, Math.min(100, Math.round(result.score)));
//     const reasons = result.reasons.slice(0, 5); // Máximo 5 razones

//     console.log(`AI Affinity: ${userA.nombre} <-> ${userB.nombre} = ${score}% (${reasons.join(", ")})`);

//     return {
//       score,
//       reasons,
//       aiGenerated: true,
//     };

//   } catch (error) {
//     console.error("Error calculating affinity with AI:", error);
//     // Fallback al algoritmo manual
//     return calculateAffinityScoreFallback(userA, userB);
//   }
// }

/**
 * Función de fallback: algoritmo manual de afinidad (usado si falla la IA)
 */
function calculateAffinityScoreFallback(userA, userB) {
  let score = 0;
  const reasons = [];

  // 1. Roles complementarios (+30 puntos)
  const tipoA = (userA.tipoAsistente || "").toLowerCase();
  const tipoB = (userB.tipoAsistente || "").toLowerCase();
  
  if ((tipoA === "comprador" && tipoB === "vendedor") || 
      (tipoA === "vendedor" && tipoB === "comprador")) {
    score += 30;
    reasons.push("Roles complementarios");
  }

  // 2. Coincidencia de intereses (+25 puntos)
  if (userA.interesPrincipal && userB.interesPrincipal && 
      userA.interesPrincipal === userB.interesPrincipal) {
    score += 25;
    reasons.push("Mismo interés principal");
  }

  // 3. Keywords en descripción/necesidad (+20 puntos máximo)
  const extractKeywords = (text) => {
    if (!text) return [];
    return text.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10);
  };

  const keywordsA = extractKeywords(userA.necesidad || userA.descripcion || "");
  const textB = (userB.necesidad || userB.descripcion || "").toLowerCase();
  
  const matchingKeywords = keywordsA.filter(kw => textB.includes(kw));
  if (matchingKeywords.length > 0) {
    const keywordScore = Math.min(20, matchingKeywords.length * 5);
    score += keywordScore;
    reasons.push(`${matchingKeywords.length} palabras clave coinciden`);
  }

  // 4. Mismo sector/categoría (+15 puntos)
  const empresaA = (userA.empresa || userA.company_razonSocial || "").toLowerCase();
  const empresaB = (userB.empresa || userB.company_razonSocial || "").toLowerCase();
  
  const sectores = ["tecnología", "alimentos", "construcción", "textil", "salud", "educación"];
  const sectorA = sectores.find(s => empresaA.includes(s));
  const sectorB = sectores.find(s => empresaB.includes(s));
  
  if (sectorA && sectorB && sectorA === sectorB) {
    score += 15;
    reasons.push(`Mismo sector: ${sectorA}`);
  }

  // 5. Actividad reciente (+10 puntos)
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  if (userB.lastConnection) {
    let lastConn;
    if (userB.lastConnection.toDate) {
      lastConn = userB.lastConnection.toDate();
    } else if (typeof userB.lastConnection === "string") {
      lastConn = new Date(userB.lastConnection);
    } else if (userB.lastConnection instanceof Date) {
      lastConn = userB.lastConnection;
    }
    
    if (lastConn && lastConn > oneDayAgo) {
      score += 10;
      reasons.push("Activo recientemente");
    }
  }

  return {
    score: Math.min(100, score),
    reasons,
    aiGenerated: false,
  };
}

/**
 * Trigger: Calcular afinidad cuando se crea un nuevo usuario
 * Se ejecuta automáticamente al crear un documento en /users/{userId}
 */
export const calculateAffinityOnUserCreate = onDocumentCreated(
  {
    document: "users/{userId}",
    region: "us-central1",
    memory: "512MiB",
    secrets: ["GEMINI_API_KEY", "GEMINI_API_URL", "DEFAULT_AI_MODEL"],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return;
    }

    const newUserId = event.params.userId;
    const newUserData = snapshot.data();
    const eventId = newUserData.eventId;

    if (!eventId) {
      console.log(`User ${newUserId} has no eventId, skipping affinity calculation`);
      return;
    }

    console.log(`Calculating affinity for new user ${newUserId} in event ${eventId}`);

    const db = getFirestore();

    try {
      // Generar embedding del nuevo usuario
      console.log(`Generating embedding for new user ${newUserId}`);
      const embeddingResult = await generateUserEmbedding(newUserData);
      
      if (embeddingResult) {
        // Guardar el embedding y el texto condensado en el documento del usuario
        await db.collection("users").doc(newUserId).update({
          vector: embeddingResult.vector,
          condensedText: embeddingResult.condensedText,
          vectorGeneratedAt: new Date(),
        });
        console.log(`Embedding and condensed text saved for user ${newUserId}`);
      } else {
        console.warn(`Failed to generate embedding for user ${newUserId}`);
      }

      // Obtener todos los usuarios del mismo evento (excepto el nuevo)
      const usersSnap = await db.collection("users")
        .where("eventId", "==", eventId)
        .get();

      const otherUsers = usersSnap.docs
        .filter(doc => doc.id !== newUserId)
        .map(doc => ({ id: doc.id, ...doc.data() }));

      console.log(`Found ${otherUsers.length} other users in event ${eventId}`);

      if (otherUsers.length === 0) {
        console.log("No other users to calculate affinity with");
        return;
      }

      // Calcular afinidad con cada usuario usando embeddings (una sola vez por par)
      let batch = db.batch();
      let calculatedCount = 0;
      const highAffinityNotifications = []; // Para notificaciones de alta afinidad
      const affinityResults = new Map(); // Cache de resultados de afinidad

      for (const otherUser of otherUsers) {
        // Generar embedding del otro usuario si no lo tiene
        let otherUserEmbedding = otherUser.vector;
        
        if (!otherUserEmbedding) {
          console.log(`Generating embedding for existing user ${otherUser.id}`);
          const embeddingResult = await generateUserEmbedding(otherUser);
          
          if (embeddingResult) {
            otherUserEmbedding = embeddingResult.vector;
            // Guardar el embedding y texto condensado en el documento del usuario
            await db.collection("users").doc(otherUser.id).update({
              vector: embeddingResult.vector,
              condensedText: embeddingResult.condensedText,
              vectorGeneratedAt: new Date(),
            });
          }
        }
        
        // Calcular afinidad usando embeddings
        const affinity = await calculateAffinityWithEmbeddings(
          newUserData, 
          otherUser,
          embeddingResult?.vector,
          otherUserEmbedding
        );
        
        // Guardar en cache para reutilizar en matches
        affinityResults.set(otherUser.id, affinity);

        // Guardar afinidad del nuevo usuario hacia el otro
        const affinityRefAtoB = db.collection("users")
          .doc(newUserId)
          .collection("affinityScores")
          .doc(otherUser.id);

        batch.set(affinityRefAtoB, {
          targetUserId: otherUser.id,
          targetName: otherUser.nombre || "Sin nombre",
          targetCompany: otherUser.empresa || otherUser.company_razonSocial || "Sin empresa",
          score: affinity.score,
          reasons: affinity.reasons,
          aiGenerated: affinity.aiGenerated || false,
          eventId: eventId,
          calculatedAt: new Date(),
        });

        // Guardar el MISMO score en el otro usuario (simétrico)
        const affinityRefBtoA = db.collection("users")
          .doc(otherUser.id)
          .collection("affinityScores")
          .doc(newUserId);

        batch.set(affinityRefBtoA, {
          targetUserId: newUserId,
          targetName: newUserData.nombre || "Sin nombre",
          targetCompany: newUserData.empresa || newUserData.company_razonSocial || "Sin empresa",
          score: affinity.score, // MISMO SCORE
          reasons: affinity.reasons, // MISMAS RAZONES
          aiGenerated: affinity.aiGenerated || false,
          eventId: eventId,
          calculatedAt: new Date(),
        });

        calculatedCount += 2;

        // Si la afinidad es mayor a 80%, notificar al usuario ANTIGUO
        if (affinity.score > 89) {
          highAffinityNotifications.push({
            userId: otherUser.id, // Usuario antiguo recibe la notificación
            targetUserId: newUserId,
            targetName: newUserData.nombre || "Sin nombre",
            targetCompany: newUserData.empresa || newUserData.company_razonSocial || "Sin empresa",
            targetRole: newUserData.tipoAsistente || "Asistente",
            targetInterest: newUserData.interesPrincipal || "",
            score: affinity.score,
            reasons: affinity.reasons,
          });
        }

        // Firestore batch tiene límite de 500 operaciones
        if (calculatedCount >= 450) {
          await batch.commit();
          console.log(`Committed batch of ${calculatedCount} affinity scores`);
          batch = db.batch(); // Crear nuevo batch
          calculatedCount = 0;
        }
      }

      // Commit final si quedan operaciones
      if (calculatedCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${calculatedCount} affinity scores`);
      }

      // Crear notificaciones de alta afinidad (>80%) y matches (>=70%)
      const matchesBatch = db.batch();
      let matchesCount = 0;
      
      if (highAffinityNotifications.length > 0) {
        console.log(`Creating ${highAffinityNotifications.length} high affinity notifications`);
        
        for (const notif of highAffinityNotifications) {
          const reasonsText = notif.reasons.length > 0 
            ? notif.reasons.join(", ") 
            : "Perfil compatible";
          
          await db.collection("notifications").add({
            userId: notif.userId,
            title: "¡Nueva persona con alta afinidad!",
            message: `${notif.targetName} (${notif.targetCompany}) se ha registrado y tienen ${notif.score}% de afinidad. ${reasonsText}.`,
            timestamp: new Date(),
            read: false,
            type: "high_affinity",
            entityType: "assistant",
            entityId: notif.targetUserId,
            affinityScore: notif.score,
            eventId: eventId,
          });
        }
        
        console.log(`Created ${highAffinityNotifications.length} high affinity notifications`);
      }

      // Crear matches para afinidades >= 70% usando los resultados cacheados
      for (const otherUser of otherUsers) {
        const affinity = affinityResults.get(otherUser.id); // Reutilizar cálculo anterior
        
        if (affinity && affinity.score >= 89) {
          // Crear match para el usuario ANTIGUO (otherUser)
          const matchRefOld = db.collection("users")
            .doc(otherUser.id)
            .collection("matches")
            .doc(newUserId);
          
          matchesBatch.set(matchRefOld, {
            userId: newUserId,
            userName: newUserData.nombre || "Sin nombre",
            userCompany: newUserData.empresa || newUserData.company_razonSocial || "Sin empresa",
            userRole: newUserData.tipoAsistente || null,
            userInterest: newUserData.interesPrincipal || null,
            userPhoto: newUserData.photoURL || null,
            userEmail: newUserData.correo || null,
            userPhone: newUserData.telefono || null,
            userPosition: newUserData.cargo || null,
            userDescription: newUserData.descripcion || null,
            userNeed: newUserData.necesidad || null,
            affinityScore: affinity.score,
            reasons: affinity.reasons,
            aiGenerated: affinity.aiGenerated || false,
            status: "pending", // pending, meeting_requested, dismissed
            eventId: eventId,
            createdAt: new Date(),
          });
          
          // Crear match para el usuario NUEVO (simétrico)
          const matchRefNew = db.collection("users")
            .doc(newUserId)
            .collection("matches")
            .doc(otherUser.id);
          
          matchesBatch.set(matchRefNew, {
            userId: otherUser.id,
            userName: otherUser.nombre || "Sin nombre",
            userCompany: otherUser.empresa || otherUser.company_razonSocial || "Sin empresa",
            userRole: otherUser.tipoAsistente || null,
            userInterest: otherUser.interesPrincipal || null,
            userPhoto: otherUser.photoURL || null,
            userEmail: otherUser.correo || null,
            userPhone: otherUser.telefono || null,
            userPosition: otherUser.cargo || null,
            userDescription: otherUser.descripcion || null,
            userNeed: otherUser.necesidad || null,
            affinityScore: affinity.score,
            reasons: affinity.reasons,
            aiGenerated: affinity.aiGenerated || false,
            status: "pending",
            eventId: eventId,
            createdAt: new Date(),
          });
          
          matchesCount += 2;
          
          // Commit cada 450 operaciones
          if (matchesCount >= 450) {
            await matchesBatch.commit();
            console.log(`Committed batch of ${matchesCount} matches`);
            matchesCount = 0;
          }
        }
      }
      
      // Commit final de matches
      if (matchesCount > 0) {
        await matchesBatch.commit();
        console.log(`Committed final batch of ${matchesCount} matches`);
      }

      console.log(`Affinity calculation complete for user ${newUserId}`);

    } catch (error) {
      console.error("Error calculating affinity:", error);
      throw error;
    }
  }
);

/**
 * Función HTTP para recalcular afinidad de todos los usuarios de un evento
 * Útil para recalcular después de cambios en el algoritmo
 * 
 * Uso: POST https://[region]-[project].cloudfunctions.net/recalculateEventAffinity
 * Body: { "eventId": "xxx" }
 */
export const recalculateEventAffinity = onRequest(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: ["GEMINI_API_KEY", "GEMINI_API_URL", "DEFAULT_AI_MODEL"],
  },
  async (req, res) => {
    // CORS headers
    const origin = req.headers.origin || "*";
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Credentials": "true",
    });

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send({ error: "Method not allowed" });
      return;
    }

    const eventId = req.body?.eventId;

    if (!eventId) {
      res.status(400).send({ error: "Missing eventId" });
      return;
    }

    console.log(`Recalculating affinity for all users in event ${eventId}`);

    const db = getFirestore();

    try {
      // Obtener todos los usuarios del evento
      const usersSnap = await db.collection("users")
        .where("eventId", "==", eventId)
        .get();

      const allUsers = usersSnap.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));

      console.log(`Found ${allUsers.length} users in event ${eventId}`);

      if (allUsers.length < 2) {
        res.status(200).send({ 
          message: "Not enough users to calculate affinity",
          usersCount: allUsers.length,
        });
        return;
      }

      // Generar embeddings para todos los usuarios que no los tengan
      console.log("Generating embeddings for users without vectors...");
      for (const user of allUsers) {
        if (!user.vector) {
          console.log(`Generating embedding for user ${user.id}`);
          const embeddingResult = await generateUserEmbedding(user);
          
          if (embeddingResult) {
            await db.collection("users").doc(user.id).update({
              vector: embeddingResult.vector,
              condensedText: embeddingResult.condensedText,
              vectorGeneratedAt: new Date(),
            });
            user.vector = embeddingResult.vector; // Actualizar en memoria
            user.condensedText = embeddingResult.condensedText;
          }
        }
      }
      console.log("Embeddings generation complete");

      let totalCalculations = 0;
      let batchCount = 0;
      let batch = db.batch();

      // Calcular afinidad entre todos los pares de usuarios (simétrico) usando embeddings
      // Solo calculamos una vez por par (i < j) y guardamos en ambas direcciones
      for (let i = 0; i < allUsers.length; i++) {
        const userA = allUsers[i];

        for (let j = i + 1; j < allUsers.length; j++) {
          const userB = allUsers[j];
          
          // Calcular afinidad UNA SOLA VEZ usando embeddings
          const affinity = await calculateAffinityWithEmbeddings(
            userA, 
            userB,
            userA.vector,
            userB.vector
          );

          // Guardar en userA -> userB
          const affinityRefAtoB = db.collection("users")
            .doc(userA.id)
            .collection("affinityScores")
            .doc(userB.id);

          batch.set(affinityRefAtoB, {
            targetUserId: userB.id,
            targetName: userB.nombre || "Sin nombre",
            targetCompany: userB.empresa || userB.company_razonSocial || "Sin empresa",
            score: affinity.score,
            reasons: affinity.reasons,
            aiGenerated: affinity.aiGenerated || false,
            eventId: eventId,
            calculatedAt: new Date(),
          });

          // Guardar el MISMO score en userB -> userA (simétrico)
          const affinityRefBtoA = db.collection("users")
            .doc(userB.id)
            .collection("affinityScores")
            .doc(userA.id);

          batch.set(affinityRefBtoA, {
            targetUserId: userA.id,
            targetName: userA.nombre || "Sin nombre",
            targetCompany: userA.empresa || userA.company_razonSocial || "Sin empresa",
            score: affinity.score, // MISMO SCORE
            reasons: affinity.reasons, // MISMAS RAZONES
            aiGenerated: affinity.aiGenerated || false,
            eventId: eventId,
            calculatedAt: new Date(),
          });

          batchCount += 2;
          totalCalculations += 2;

          // Commit cada 450 operaciones (límite de Firestore es 500)
          if (batchCount >= 450) {
            await batch.commit();
            console.log(`Committed batch: ${totalCalculations} calculations so far`);
            batch = db.batch();
            batchCount = 0;
          }
        }
      }

      // Commit final
      if (batchCount > 0) {
        await batch.commit();
        console.log(`Committed final batch: ${totalCalculations} total calculations`);
      }

      res.status(200).send({
        message: "Affinity recalculation complete",
        eventId,
        usersCount: allUsers.length,
        totalCalculations,
      });

    } catch (error) {
      console.error("Error recalculating affinity:", error);
      res.status(500).send({ 
        error: "Recalculation failed", 
        details: error.message 
      });
    }
  }
);
