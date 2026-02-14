
import { GoogleGenAI } from "@google/genai";

// Advice from Gemini based on financial summary
export const getFinancialAdvice = async (summary: any) => {
  try {
    // Initializing Gemini with API key from environment exclusively
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Aşağıdaki apartman mali durumu için yöneticiye tek cümlelik, Türkçe, profesyonel bir tavsiye ver: ${JSON.stringify(summary)}`,
    });
    
    // Extracting text from response property
    return response.text || "Mali verileri düzenli tutmaya devam edin.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Mali verileri düzenli tutmaya devam edin.";
  }
};
