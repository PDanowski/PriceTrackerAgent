import { GoogleGenAI, Type } from '@google/genai';
import * as cheerio from 'cheerio';

export async function runGeminiScrapeFallback(
  ai: GoogleGenAI,
  parsedUrl: URL,
  targetSku: string | null,
  html: string
): Promise<{
  title?: string;
  price?: number;
  currency?: string;
  inStock?: boolean;
  imageUrl?: string;
}> {
  try {
    let bodySnippet = '';
    if (html) {
      const $snippet = cheerio.load(html);
      $snippet('script, style, noscript, svg, nav, footer, header').remove();
      bodySnippet = $snippet('main, #main, #content, body').text().replace(/\s+/g, ' ').trim().slice(0, 2500);
    }
    const prompt = `Extract product details for main item at URL "${parsedUrl.href}"${targetSku ? ` (Specific SKU/Article code: ${targetSku})` : ''}.
CRITICAL INSTRUCTION: Identify ONLY the actual buying price to pay (sale price) for the EXACT product variant / colorway referenced in the URL${targetSku ? ` (SKU: ${targetSku})` : ''}. Do NOT extract prices of other color options, variant pickers, strikethrough list prices, recommended RRP, unit prices, or shipping costs.
Parse the exact currency symbol or code (e.g. "zł", "PLN", "€", "$", "£", "CHF") as displayed on the webpage.

Page text snippet:
"""${bodySnippet}"""`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Main product name or title',
        },
        price: {
          type: Type.NUMBER,
          description: 'Current purchasing price numeric value (e.g. 1499.00)',
        },
        currency: {
          type: Type.STRING,
          description: 'Exact currency symbol or code extracted from page (e.g. zł, $, €, £, CHF, PLN)',
        },
        inStock: {
          type: Type.BOOLEAN,
          description: 'Availability status (true if available to buy, false if out of stock)',
        },
        imageUrl: {
          type: Type.STRING,
          description: 'Optional absolute image URL for product',
        },
      },
      required: ['title', 'price', 'currency', 'inStock'],
    };

    const modelsToTry = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.6-pro'];
    let textResp = '';

    for (const modelName of modelsToTry) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API request timeout (4s exceeded)')), 4000)
        );

        const apiPromise = ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        });

        const response = await Promise.race([apiPromise, timeoutPromise]);
        textResp = response.text?.trim() || '';
        if (textResp) break;
      } catch (modelErr: any) {
        const errText = modelErr?.message || String(modelErr);
        if (errText.includes('503') || errText.includes('UNAVAILABLE') || errText.includes('high demand') || errText.includes('500') || errText.includes('INTERNAL')) {
          console.warn(`⚠️ Gemini model '${modelName}' high demand/unavailable. Trying next model...`);
          continue;
        }
        if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quota')) {
          console.warn(`⚠️ Gemini model '${modelName}' quota/rate limit reached. Trying fallback model...`);
          continue;
        }
        if (errText.includes('404') || errText.includes('NOT_FOUND') || errText.includes('no longer available')) {
          console.warn(`⚠️ Gemini model '${modelName}' unavailable. Trying next model...`);
          continue;
        }
        if (errText.includes('timeout')) {
          console.warn(`⚠️ Gemini model '${modelName}' timed out. Trying next model...`);
          continue;
        }
        console.warn(`⚠️ Gemini model '${modelName}' error: ${errText.slice(0, 150)}. Trying next model...`);
        continue;
      }
    }

    if (textResp) {
      return JSON.parse(textResp);
    }
  } catch (geminiErr: any) {
    const msg = geminiErr?.message || String(geminiErr);
    console.warn('Gemini structured response extraction note:', msg);
  }
  return {};
}
