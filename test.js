require("dotenv").config({ path: "./.env" });

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function test() {
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest"
        });

        const result = await model.generateContent("Say hello in one line.");

        console.log("SUCCESS:");
        console.log(result.response.text());

    } catch (error) {
        console.error("REAL ERROR:");
        console.error(error);
    }
}

test();