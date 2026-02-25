import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const start = Date.now();
        const formData = await request.formData();
        const file = formData.get('file') as Blob | null;

        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        // Construct FormData for OpenAI
        const openAIFormData = new FormData();
        const audioFile = new File([file], 'audio.webm', {
            type: file.type || 'audio/webm',
        });
        openAIFormData.append('file', audioFile);
        openAIFormData.append('model', 'whisper-1');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: openAIFormData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Transcription API] OpenAI Error:', errorText);
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('[Transcription API] Success in', Date.now() - start, 'ms');
        return NextResponse.json({ text: data.text });

    } catch (error: any) {
        console.error('[Transcription API Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to transcribe audio' },
            { status: 500 }
        );
    }
}
