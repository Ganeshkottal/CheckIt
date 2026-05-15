require("dotenv").config({ path: "./.env" });
console.log("ENV loaded");

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many requests. Try again later."
});
app.use(limiter);

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Only images allowed"));
  }
});


app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.use(express.json());

app.post("/evaluate", upload.single("answerImage"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ score: 0, feedback: "No file uploaded" });


    if (!req.body.question || !req.body.keypoints || !req.body.maxMarks) {
      return res.status(400).json({
        score: 0,
        feedback: "Missing required fields"
      });
    }



    const maxMarks = Number(req.body.maxMarks);

    if (isNaN(maxMarks) || maxMarks <= 0 || maxMarks > 20) {
      return res.status(400).json({
        score: 0,
        feedback: "Invalid maximum marks"
      });
    }

    if (req.body.question.trim().length < 5) {
      return res.status(400).json({
        score: 0,
        feedback: "Question is too short"
      });
    }



    const formData = new FormData();
    formData.append("file", fs.createReadStream(req.file.path));
    formData.append("apikey", process.env.OCR_SPACE_API_KEY);
    formData.append("language", "eng");
    formData.append("isOverlayRequired", "false");
    formData.append("OCREngine", "2");
    formData.append("scale", "true");
    formData.append("detectOrientation", "true");
    formData.append("isTable", "false");

    console.log("CALLING OCR");
    const ocrResponse = await axios.post(
      "https://api.ocr.space/parse/image",
      formData,
      { headers: formData.getHeaders() }
    );

    const extractedText = ocrResponse.data.ParsedResults?.[0]?.ParsedText || "";
    if (extractedText.trim().length < 5) {
      return res.json({
        score: 0,
        feedback: "Unable to detect proper handwriting from image"
      });
    }

    console.log("OCR TEXT:", extractedText);

    if (extractedText.trim().length < 15) {
      return res.json({
        score: 0,
        feedback: "Unable to detect proper answer from image. Please upload clearer image."
      });
    }


    // ── SHORT BUT COMPLETE PROMPT ──────────────────────────
    const prompt = `You are a strict school teacher. Evaluate the student's answer and return ONLY a JSON object.

Q: ${req.body.question}
Key Points: ${req.body.keypoints}
Max Marks: ${req.body.maxMarks}
Student Answer: ${extractedText}

RULES:
- If question is invalid/meaningless: {"score":0,"feedback":"Invalid question"}
- If answer is irrelevant to question: score near 0 even if keywords match
- Full marks ONLY for correct + clear + complete answers
- Partial marks for partial understanding
- Keywords alone without explanation = low marks
- Genuine attempt = minimum 0.5 (never harsh zero for effort)
- Never exceed max marks
- Be like a real strict school teacher

Reply ONLY with: {"score": number, "feedback": "one line"}`;

    console.log("CALLING AI");
    const aiResponse = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        messages: [
          {
            role: "system",
            content: "You are a strict school teacher. Always reply only with valid JSON. No extra text."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );

    const rawReply = aiResponse.data.choices[0].message.content;
    console.log("RAW AI:", rawReply);

    const cleanedReply = rawReply.replace(/```json/g, "").replace(/```/g, "").trim();

    let finalResult;
    try {

      console.log("========== NEW REQUEST ==========");
      console.log("Question:", req.body.question);
      console.log("Max Marks:", req.body.maxMarks);
      console.log("File:", req.file?.filename);

      finalResult = JSON.parse(cleanedReply);
    } catch (err) {
      console.error("JSON PARSE FAILED:", cleanedReply);
      return res.status(500).json({ score: 0, feedback: "AI returned invalid format" });
    }

    let score = Number(finalResult.score);
    const maxMarks = Number(req.body.maxMarks);
    score = Math.min(maxMarks, Math.max(0, score));
    score = Math.round(score * 2) / 2;

    console.log("FINAL:", { score, feedback: finalResult.feedback });

    return res.json({
      ocrText: extractedText,
      score,
      feedback: finalResult.feedback
    });

  } catch (error) {
    console.error("ERROR:", error.response?.data || error.message);
    return res.status(500).json({ score: 0, feedback: "Evaluation failed. Please try again." });

  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, (err) => { if (err) console.error("Cleanup failed:", err); });
    }
  }
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Server running on port 3000");
});