import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

function bearerToken(request: Request): string {
    const auth = request.headers.get("authorization") || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
}

function stringField(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const text = stringField(body.input ?? body.text);
        const voiceId = stringField(body.voice ?? body.voice_id);
        const modelId = stringField(body.model ?? body.model_id) || DEFAULT_MODEL;
        const envKey = process.env.ELEVENLABS_API_KEY?.trim() || "";
        const requestKey = bearerToken(request);
        const apiKey = envKey || (requestKey === "server-managed" ? "" : requestKey);

        if (!apiKey) {
            return NextResponse.json(
                { error: "missing_api_key", message: "ElevenLabs API Key 未配置。请在 Netlify 设置 ELEVENLABS_API_KEY。" },
                { status: 400 },
            );
        }
        if (!text) {
            return NextResponse.json({ error: "missing_text", message: "缺少待合成文本" }, { status: 400 });
        }
        if (!voiceId) {
            return NextResponse.json({ error: "missing_voice", message: "缺少 ElevenLabs Voice ID" }, { status: 400 });
        }

        const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${DEFAULT_OUTPUT_FORMAT}`;
        const upstream = await proxyFetch(url, {
            method: "POST",
            headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
            },
            body: JSON.stringify({
                text,
                model_id: modelId,
            }),
        });

        if (!upstream.ok) {
            const errorText = await upstream.text().catch(() => "");
            return NextResponse.json(
                {
                    error: "elevenlabs_tts_failed",
                    message: errorText.slice(0, 1000) || `ElevenLabs 请求失败 (${upstream.status})`,
                },
                { status: upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502 },
            );
        }

        const audio = await upstream.arrayBuffer();
        return new Response(audio, {
            status: 200,
            headers: {
                "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: "elevenlabs_tts_proxy_failed", message: message.slice(0, 1000) },
            { status: 502 },
        );
    }
}
