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
  { region: "us-central1", memory: "256MiB", secrets: [GEMINI_API_KEY, GEMINI_API_URL, DEFAULT_AI_MODEL], },
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

      // 1) Ask Gemini to extract keywords and target scopes (assistants/products/companies)
      // Include user's profile fields to improve keyword extraction and intent
      const profileParts = [];
      if (descripcion) profileParts.push(`descripcion: ${descripcion}`);
      if (necesidad) profileParts.push(`necesidad: ${necesidad}`);
      if (interesPrincipal) profileParts.push(`interesPrincipal: ${interesPrincipal}`);
      if (tipoAsistente) profileParts.push(`tipoAsistente: ${tipoAsistente}`);

      const profileText = profileParts.length ? `\nUser profile: ${profileParts.join(' | ')}` : "";
      console.log("Profile text for AI:", profileText);
      
      const instruct = `You are an assistant that extracts search keywords and intent scopes from a user's free text query for a networking event platform.

**IMPORTANT INSTRUCTIONS:**
- If the user message is ONLY a greeting (e.g., "hola", "buenos días", "hey", "saludos") or is completely irrelevant to searching for assistants/products/companies, return EMPTY arrays for both keywords and scopes: {"keywords": [], "scopes": []}
- If the message contains ANY search intent or request (even combined with a greeting), extract the relevant keywords and scopes normally
- Do NOT return empty arrays if there's actual content to search for

Return a strict JSON object with two fields:
- keywords: array of short search terms (max 12 words, filter out stopwords and irrelevant terms)
- scopes: array with any of: "assistants", "products", "companies" (based on what the user is looking for)

User query: "${message.replace(/"/g, '\\"')}"${profileText}`;

      // Build request body matching Gemini `generateContent` shape
      const primaryBody = {
        contents: [
          {
            parts: [
              {
                text: instruct,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
          responseMimeType: "application/json",
        },
      };

      let aiJson = null;
      let aiText = "";
      try {
        const primaryResp = await fetch(`${GEMINI_API_URL.value()}/models/${DEFAULT_AI_MODEL.value()}:generateContent?key=${GEMINI_API_KEY.value()}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(primaryBody),
        });

        if (primaryResp.ok) {
          aiJson = await primaryResp.json();
        } else {
          const t = await primaryResp.text();
          console.error("AI primary error:", t);
          // If primary fails, try alternative instances/parameters shape as fallback
          const altBody = {
            instances: [{ content: instruct }],
            parameters: { maxOutputTokens: 512 },
          };
          const altResp = await fetch(GEMINI_API_URL.value(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${GEMINI_API_KEY.value()}`,
            },
            body: JSON.stringify(altBody),
          });
          if (!altResp.ok) {
            const t2 = await altResp.text();
            console.error("AI fallback error:", t2);
            res.status(502).send({ error: "AI provider error", details: t2 });
            return;
          }
          aiJson = await altResp.json();
        }
      } catch (e) {
        console.error("AI request failed:", e);
        res.status(502).send({ error: "AI provider error" });
        return;
      }

      // Extract text from known Gemini/Vertex response shapes
      if (aiJson) {
        if (aiJson.candidates && aiJson.candidates[0] && aiJson.candidates[0].content && aiJson.candidates[0].content.parts && aiJson.candidates[0].content.parts[0] && aiJson.candidates[0].content.parts[0].text) {
          aiText = aiJson.candidates[0].content.parts[0].text;
        } else if (aiJson.choices && aiJson.choices[0] && aiJson.choices[0].text) {
          aiText = aiJson.choices[0].text;
        } else if (aiJson.output && typeof aiJson.output === "string") {
          aiText = aiJson.output;
        } else if (aiJson.output && Array.isArray(aiJson.output) && aiJson.output[0] && aiJson.output[0].content) {
          aiText = aiJson.output[0].content;
        } else if (aiJson.result) {
          aiText = JSON.stringify(aiJson.result);
        } else {
          aiText = JSON.stringify(aiJson);
        }
      }

      // Attempt to parse JSON from AI response
      let parsed = { keywords: [], scopes: [] };
      try {
        const maybe = aiText.trim();
        const jsonStart = maybe.indexOf("{");
        const jsonStr = jsonStart >= 0 ? maybe.slice(jsonStart) : maybe;
        parsed = JSON.parse(jsonStr);
      } catch (err) {
        console.warn("Could not parse AI response as JSON, falling back to simple extraction", err);
        // fallback: simple words extraction (Unicode-aware, remove diacritics)
        const simpleKws = (String(message) || '').match(/\p{L}+/gu) || [];
        parsed.keywords = simpleKws.slice(0, 8).map((k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
        parsed.scopes = ["assistants", "products", "companies"];
      }

      // Si la IA retornó arrays vacíos, es un saludo o mensaje irrelevante
      if (!Array.isArray(parsed.keywords) || parsed.keywords.length === 0 || 
          !Array.isArray(parsed.scopes) || parsed.scopes.length === 0) {
        
        // Generar respuesta amable con la IA
        const greetingPrompt = `Eres un asistente virtual para networking en eventos. El usuario ha enviado un saludo o mensaje sin consulta específica. Responde de forma breve, amable y profesional (máximo 2 líneas), saludando cordialmente y animando al usuario a consultar sobre asistentes, empresas o productos del evento. No uses emojis excesivos, mantén un tono profesional.

Mensaje del usuario: "${message}"`;

        let aiGreetingMessage = "¡Hola! Estoy aquí para ayudarte. ¿En qué te puedo asistir? Puedes consultar sobre asistentes, empresas o productos del evento.";
        
        try {
          const greetingResp = await fetch(`${GEMINI_API_URL.value()}/models/${DEFAULT_AI_MODEL.value()}:generateContent?key=${GEMINI_API_KEY.value()}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: greetingPrompt }] }],
              generationConfig: { 
                temperature: 0.7, 
                maxOutputTokens: 100, 
                responseMimeType: "text/plain" 
              },
            }),
          });
          
          if (greetingResp.ok) {
            const greetingJson = await greetingResp.json();
            if (greetingJson.candidates && greetingJson.candidates[0] && greetingJson.candidates[0].content && greetingJson.candidates[0].content.parts && greetingJson.candidates[0].content.parts[0] && greetingJson.candidates[0].content.parts[0].text) {
              aiGreetingMessage = greetingJson.candidates[0].content.parts[0].text.trim();
            }
          }
        } catch (e) {
          console.warn("AI greeting generation failed, using default", e);
        }

        // Guardar el chat con el saludo
        const chatRef = db.collection("aiChats").doc();
        await chatRef.set({
          userId,
          eventId: eventId || null,
          message,
          profile: {
            descripcion: descripcion || null,
            necesidad: necesidad || null,
            interesPrincipal: interesPrincipal || null,
            tipoAsistente: tipoAsistente || null,
          },
          keywords: [],
          scopes: [],
          aiMessage: aiGreetingMessage,
          summary: null,
          resultsSummary: {
            assistants: 0,
            products: 0,
            companies: 0,
          },
          isGreeting: true,
          createdAt: new Date().toISOString(),
          aiRaw: aiJson,
        });

        res.status(200).send({
          chatId: chatRef.id,
          results: { assistants: [], products: [], companies: [] },
          message: aiGreetingMessage,
          summary: null,
          isGreeting: true
        });
        return;
      }

      // Normalize and clean keywords: keep unicode letters, remove diacritics, filter stopwords and short fragments
      const normalizeText = (s) =>
        String(s || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .trim();

      const extractWords = (s) => (normalizeText(s).match(/\p{L}+/gu) || []).map((w) => w.trim()).filter(Boolean);

      const stopwords = new Set([
        'de','y','en','la','el','los','las','un','una','con','para','por','del','al','todo','tipo','su'
      ]);

      const rawFromAI = (parsed.keywords || []).flatMap((k) => extractWords(String(k)));
      const profileWords = [];
      if (descripcion) profileWords.push(...extractWords(descripcion));
      if (necesidad) profileWords.push(...extractWords(necesidad));
      if (interesPrincipal) profileWords.push(...extractWords(interesPrincipal));

      let keywords = Array.from(new Set([...rawFromAI, ...profileWords]))
        .map((k) => k.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
        .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !stopwords.has(w));

      // Limit to a concise set
      keywords = keywords.slice(0, 12);
      
      const scopes = Array.isArray(parsed.scopes) && parsed.scopes.length ? parsed.scopes : ["assistants", "products", "companies"];
      
      console.log("extracted scopes:", scopes, "keywords:", keywords);

      // If frontend provided tipoAsistente, try to invert intent: vendedor -> buscar compradores, comprador -> buscar vendedores
      const userTipo = tipoAsistente ? String(tipoAsistente).toLowerCase() : null;
      let desiredOpposite = null;
      if (userTipo === "vendedor") desiredOpposite = "comprador";
      else if (userTipo === "comprador") desiredOpposite = "vendedor";

      const results = { assistants: [], products: [], companies: [] };

      // Helper to check fields for keywords
      const matchesAny = (obj, fields) => {
        const text = fields
          .map((f) => (obj[f] || "")).join(" ")
          .toString()
          .toLowerCase();
        return keywords.some((kw) => text.includes(kw));
      };

      // Search assistants: users collection filtered by eventId
      if (scopes.includes("assistants")) {
        try {
          const usersQuery = eventId ? db.collection("users").where("eventId", "==", eventId) : db.collection("users");
          const usersSnap = await usersQuery.get();
          usersSnap.forEach((d) => {
            // exclude the requesting user from results
            if (d.id === userId) return;
            const o = d.data();
            // If user provided tipoAsistente, prefer returning assistants of the opposite type
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

      // Search products: event subcollection 'products'
      if (scopes.includes("products")) {
        try {
          let productsSnap = null;
          if (eventId) {
            productsSnap = await db.collection("events").doc(eventId).collection("products").get();
          }
        
          if (productsSnap) {
            productsSnap.forEach((d) => {
              const o = d.data();
              if (matchesAny(o, [
                "title",
                "description",
                "category",
              ])) {
                results.products.push({ id: d.id, ...o });
              }
            });
          }
        } catch (err) {
          console.warn("Products query failed", err);
        }
      }

      // Companies: event companies collection
      if (scopes.includes("companies")) {
        try {
          let companiesSnap = null;
          if (eventId) {
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
          }
          if (companiesSnap) {
            for (const d of companiesSnap.docs) {
              const o = d.data();
              if (matchesAny(o, ["razonSocial", "descripcion"])) {
                // Buscar asistentes de la empresa usando nitNorm y eventId
                let companyAssistants = [];
                if (o.nitNorm) {
                  try {
                    const assistantsSnap = await db.collection("users")
                      .where("eventId", "==", eventId)
                      .where("company_nit", "==", o.nitNorm)
                      .get();
                    companyAssistants = assistantsSnap.docs.map((ad) => ({ id: ad.id, ...ad.data() }));
                  } catch (err) {
                    console.warn(`Error buscando asistentes para empresa ${o.razonSocial} (${o.nitNorm})`, err);
                  }
                }
                results.companies.push({ id: d.id, ...o, assistants: companyAssistants });
              }
            }
          }
        } catch (e) {
          console.warn("Companies derivation failed", e);
        }
      }

      const aiMessage = `Espera un momento mientras busco los resultados que necesitas.`;
      const summary = `Encontré ${results.assistants.length} asistente${results.assistants.length !== 1 ? "s" : ""}, ${results.products.length} producto${results.products.length !== 1 ? "s" : ""} y ${results.companies.length} empresa${results.companies.length !== 1 ? "s" : ""}.`;

      // Persist chat
      const chatRef = db.collection("aiChats").doc();
      await chatRef.set({
        userId,
        eventId: eventId || null,
        message,
        profile: {
          descripcion: descripcion || null,
          necesidad: necesidad || null,
          interesPrincipal: interesPrincipal || null,
          tipoAsistente: tipoAsistente || null,
        },
        keywords,
        scopes,
        aiMessage,
        summary,
        resultsSummary: {
          assistants: results.assistants.length,
          products: results.products.length,
          companies: results.companies.length,
        },
        isGreeting: false,
        createdAt: new Date().toISOString(),
        aiRaw: aiJson,
      });

      res.status(200).send({ chatId: chatRef.id, results, message: aiMessage, summary });
    } catch (err) {
      console.error("aiProxy error", err);
      res.status(500).send({ error: "internal_error" });
    }
  },
);