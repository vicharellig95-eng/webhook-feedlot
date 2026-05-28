const express = require("express");
const app = express();
app.use(express.json());

const VERIFY_TOKEN    = process.env.VERIFY_TOKEN || "feedlot2024";
const WA_TOKEN        = process.env.WA_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

const NUMEROS_PERMITIDOS = [
  "5493462652871",
  "5493584249235",
];

function estaAutorizado(numero) {
  return NUMEROS_PERMITIDOS.includes(numero);
}

app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado OK");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", (req, res) => {
  // Responder a Meta inmediatamente
  res.sendStatus(200);

  // Procesar el mensaje de forma independiente (sin await)
  procesarMensaje(req.body).catch(err => console.error("Error procesando:", err));
});

async function procesarMensaje(body) {
  try {
    const entry   = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      console.log("No hay mensaje en el payload");
      return;
    }

    const from = message.from;
    const type = message.type;

    console.log(`Mensaje de ${from} — tipo: ${type}`);

    if (!estaAutorizado(from)) {
      console.log(`No autorizado: ${from}`);
      return;
    }

    console.log(`Procesando mensaje de ${from}...`);

    if (type === "text") {
      await manejarTexto(from, message.text.body.trim());
    } else if (type === "image") {
      await manejarImagen(from, message.image.id, message.image.caption || "");
    } else {
      await enviarMensaje(from, "Solo proceso texto e imágenes. Mandame una foto de bosta o datos del corral.");
    }

    console.log(`Mensaje procesado para ${from}`);

  } catch (err) {
    console.error("Error en procesarMensaje:", err);
  }
}

async function manejarTexto(from, texto) {
  const t = texto.toLowerCase();

  if (t.includes("hola") || t.includes("inicio") || t === "menu") {
    await enviarMensaje(from,
      `🐄 *Diagnóstico de Establecimientos*\n\nHola! Soy el asistente veterinario IA para feedlots.\n\nPodés:\n📸 *Foto de bosta* → análisis de consistencia\n📝 *Datos del corral* → diagnóstico completo\n\nEjemplo:\n_Corral 5, 120 novillos, 280kg, 45 días, diarrea, severidad 7_`
    );
    return;
  }

  await enviarMensaje(from, "🤔 Analizando... un momento.");

  const respuesta = await llamarOpenAI([
    { role: "system", content: `Sos un veterinario especialista en feedlots argentinos. El usuario te da datos de un corral por WhatsApp. Respondé con diagnóstico conciso y recomendaciones prácticas. Formato simple para WhatsApp, solo *negrita* para títulos. Máximo 300 palabras.` },
    { role: "user", content: texto }
  ]);

  await enviarMensaje(from, respuesta);
}

async function manejarImagen(from, imageId, caption) {
  await enviarMensaje(from, "📸 Recibí la foto, analizando...");

  const mediaRes  = await fetch(`https://graph.facebook.com/v23.0/${imageId}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
  const mediaData = await mediaRes.json();
  const imgRes    = await fetch(mediaData.url, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
  const base64   = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
  const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
  const respuesta = await llamarOpenAIVision(base64, mimeType, caption);
  await enviarMensaje(from, `💩 *Análisis de bosta:*\n\n${respuesta}`);
}

async function llamarOpenAI(messages) {
  console.log("Llamando a OpenAI...");
  const res  = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 500, messages })
  });
  const data = await res.json();
  console.log("OpenAI respondió:", JSON.stringify(data).slice(0, 100));
  return data.choices?.[0]?.message?.content || "No pude generar una respuesta.";
}

async function llamarOpenAIVision(base64, mimeType, caption) {
  console.log("Llamando a OpenAI Vision...");
  const res  = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 400,
      messages: [
        { role: "system", content: `Sos un veterinario especialista en feedlots argentinos. Analizá la foto de bosta. Evaluá consistencia, color, fibra visible, grano sin digerir. Formato simple WhatsApp. Máximo 200 palabras.` },
        { role: "user", content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: caption ? `Contexto: ${caption}` : "Analizá esta bosta de feedlot." }
        ]}
      ]
    })
  });
  const data = await res.json();
  console.log("OpenAI Vision respondió:", JSON.stringify(data).slice(0, 100));
  return data.choices?.[0]?.message?.content || "No pude analizar la imagen.";
}

async function enviarMensaje(to, texto) {
  console.log(`Enviando mensaje a ${to}...`);
  const res = await fetch(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${WA_TOKEN}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: texto }
    })
  });
  const data = await res.json();
  console.log("Respuesta Meta:", JSON.stringify(data).slice(0, 100));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
