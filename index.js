const express = require("express");
const app = express();
app.use(express.json());

// ─── Variables de entorno ───────────────────────────────────────────────────
const VERIFY_TOKEN    = process.env.VERIFY_TOKEN    || "feedlot2024";
const WA_TOKEN        = process.env.WA_TOKEN;
// ⚠️  IMPORTANTE: debe ser el Phone Number ID (ej: 1096020733600269)
// NO el WABA ID (26600419606325955)
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;   // Claude
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;  // OpenAI Vision (imágenes)
const WA_VERSION      = "v19.0";

// ─── Números autorizados ────────────────────────────────────────────────────
const NUMEROS_PERMITIDOS = [
  "5493462652871",
  "5493584249235",
];

function estaAutorizado(numero) {
  return NUMEROS_PERMITIDOS.includes(numero);
}

// ─── Webhook GET (verificación Meta) ───────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado OK");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Verificación fallida");
    res.sendStatus(403);
  }
});

// ─── Webhook POST (mensajes entrantes) ─────────────────────────────────────
app.post("/webhook", (req, res) => {
  res.sendStatus(200); // Responder a Meta inmediatamente
  procesarMensaje(req.body).catch(err =>
    console.error("Error procesando:", err.message)
  );
});

// ─── Procesador principal ───────────────────────────────────────────────────
async function procesarMensaje(body) {
  try {
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;

    const from = message.from;
    const type = message.type;
    console.log(`📩 Mensaje de ${from} — tipo: ${type}`);

    if (!estaAutorizado(from)) {
      console.log(`🚫 No autorizado: ${from}`);
      return;
    }

    if (type === "text") {
      await manejarTexto(from, message.text.body.trim());
    } else if (type === "image") {
      await manejarImagen(from, message.image.id, message.image.caption || "");
    } else {
      await enviarMensaje(from,
        "Solo proceso texto e imágenes 📝📸\n\n" +
        "Escribí _hola_ para ver las opciones disponibles."
      );
    }

    console.log(`✅ Procesado para ${from}`);
  } catch (err) {
    console.error("Error en procesarMensaje:", err.message);
  }
}

// ─── Manejo de texto ────────────────────────────────────────────────────────
async function manejarTexto(from, texto) {
  const t = texto.toLowerCase();

  // Menú de bienvenida
  if (t === "hola" || t === "inicio" || t === "menu" || t === "ayuda") {
    await enviarMensaje(from,
      `🐄 *Diagnóstico de Establecimientos*\n\n` +
      `Hola! Soy el asistente veterinario IA para feedlots.\n\n` +
      `*¿Qué podés hacer?*\n` +
      `📸 Mandá una *foto de bosta* → análisis de consistencia IA\n` +
      `📝 Describí un *corral* → diagnóstico y recomendaciones\n\n` +
      `*Ejemplo:*\n` +
      `_Corral 5, 120 novillos, 280kg, 45 días engorde, diarrea moderada, consumo bajo, severidad 7_\n\n` +
      `Escribí los datos y te respondo en segundos 👇`
    );
    return;
  }

  await enviarMensaje(from, "🔍 Analizando datos del corral...");

  const respuesta = await llamarClaude([
    {
      role: "user",
      content: texto
    }
  ],
    `Sos un veterinario especialista en feedlots argentinos con amplia experiencia en corrales de engorde.
El usuario te envía datos de un corral por WhatsApp.
Respondé con un diagnóstico conciso y recomendaciones prácticas y concretas.
Usá formato simple para WhatsApp: *negrita* solo para títulos clave.
Máximo 300 palabras. No uses markdown complejo, solo asteriscos para negrita.
Si faltan datos importantes, indicá cuáles necesitás.`
  );

  await enviarMensaje(from, respuesta);
}

// ─── Manejo de imagen ───────────────────────────────────────────────────────
async function manejarImagen(from, imageId, caption) {
  await enviarMensaje(from, "📸 Foto recibida, analizando consistencia de bosta...");

  try {
    // 1. Obtener URL real de la imagen desde Meta
    const mediaRes = await fetch(
      `https://graph.facebook.com/${WA_VERSION}/${imageId}`,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );
    if (!mediaRes.ok) throw new Error(`Error obteniendo media: ${mediaRes.status}`);
    const mediaData = await mediaRes.json();

    if (!mediaData.url) throw new Error("Meta no devolvió URL de imagen");

    // 2. Descargar la imagen
    const imgRes = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` }
    });
    if (!imgRes.ok) throw new Error(`Error descargando imagen: ${imgRes.status}`);

    const base64   = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

    // 3. Analizar con OpenAI Vision (mejor soporte de imágenes base64)
    const respuesta = await llamarOpenAIVision(base64, mimeType, caption);
    await enviarMensaje(from, `💩 *Análisis de bosta:*\n\n${respuesta}`);

  } catch (err) {
    console.error("Error procesando imagen:", err.message);
    await enviarMensaje(from,
      "⚠️ No pude procesar la imagen. " +
      "Intentá de nuevo o describí el estado de la bosta en texto."
    );
  }
}

// ─── Claude (texto) ─────────────────────────────────────────────────────────
async function llamarClaude(messages, systemPrompt) {
  console.log("🤖 Llamando a Claude...");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: systemPrompt,
      messages
    })
  });
  const data = await res.json();
  if (data.error) {
    console.error("Error Claude:", data.error);
    return "No pude generar una respuesta en este momento.";
  }
  console.log("✅ Claude respondió OK");
  return data.content?.[0]?.text || "No pude generar una respuesta.";
}

// ─── OpenAI Vision (imágenes) ───────────────────────────────────────────────
async function llamarOpenAIVision(base64, mimeType, caption) {
  console.log("👁️ Llamando a OpenAI Vision...");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `Sos un veterinario especialista en feedlots argentinos.
Analizá la foto de bosta que te mandan. Evaluá:
- Consistencia (líquida/chirle/normal/pastosa/dura)
- Color y olor aparente
- Fibra visible sin digerir
- Grano sin digerir
- Posibles causas (nutricionales/sanitarias/manejo)
Formato simple para WhatsApp. Máximo 200 palabras.`
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` }
            },
            {
              type: "text",
              text: caption ? `Contexto adicional: ${caption}` : "Analizá esta bosta de feedlot."
            }
          ]
        }
      ]
    })
  });
  const data = await res.json();
  if (data.error) {
    console.error("Error OpenAI Vision:", data.error);
    return "No pude analizar la imagen.";
  }
  console.log("✅ OpenAI Vision respondió OK");
  return data.choices?.[0]?.message?.content || "No pude analizar la imagen.";
}

// ─── Enviar mensaje WhatsApp ────────────────────────────────────────────────
async function enviarMensaje(to, texto) {
  console.log(`📤 Enviando a ${to}...`);

  if (!PHONE_NUMBER_ID) {
    console.error("❌ PHONE_NUMBER_ID no configurado en variables de entorno");
    return;
  }
  if (!WA_TOKEN) {
    console.error("❌ WA_TOKEN no configurado en variables de entorno");
    return;
  }

  const url = `https://graph.facebook.com/${WA_VERSION}/${PHONE_NUMBER_ID}/messages`;
  console.log(`📡 URL: ${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${WA_TOKEN}`
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: texto }
    })
  });

  const data = await res.json();
  if (data.error) {
    console.error("❌ Error Meta API:", JSON.stringify(data.error));
  } else {
    console.log(`✅ Enviado a ${to} — message_id: ${data.messages?.[0]?.id}`);
  }
}

// ─── Health check ───────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "online",
    phone_number_id: PHONE_NUMBER_ID || "⚠️ NO CONFIGURADO",
    wa_token: WA_TOKEN ? "✅ configurado" : "⚠️ NO CONFIGURADO",
    anthropic: ANTHROPIC_KEY ? "✅ configurado" : "⚠️ NO CONFIGURADO",
    openai: OPENAI_API_KEY ? "✅ configurado" : "⚠️ NO CONFIGURADO",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📱 PHONE_NUMBER_ID: ${PHONE_NUMBER_ID || "⚠️ NO CONFIGURADO"}`);
});
