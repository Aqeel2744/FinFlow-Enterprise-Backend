import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from './env.js';

let geminiModel: any = null;

if (env.GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    console.log('Google Gemini 1.5 Flash AI initialized');
  } catch (error) {
    console.warn('Could not initialize Gemini model:', error);
  }
} else {
  console.warn('GEMINI_API_KEY not configured. AI advisory endpoints will return rule-based fallback responses.');
}

export { geminiModel };
