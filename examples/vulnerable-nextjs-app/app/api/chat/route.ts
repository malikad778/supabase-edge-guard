import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const result = streamText({ model: openai('gpt-4o'), prompt });
  return result.toDataStreamResponse();
}
