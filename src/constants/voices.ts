import type { AudioFormat, Language, Voice } from "@/types/domain";

export const VOICES: Record<Language, readonly Voice[]> = {
  es: [
    { id: "es-ES-AlvaroNeural",  name: "Álvaro",  gender: "M", accent: "España" },
    { id: "es-ES-ElviraNeural",  name: "Elvira",  gender: "F", accent: "España" },
    { id: "es-MX-DaliaNeural",   name: "Dalia",   gender: "F", accent: "México" },
    { id: "es-MX-JorgeNeural",   name: "Jorge",   gender: "M", accent: "México" },
    { id: "es-AR-ElenaNeural",   name: "Elena",   gender: "F", accent: "Argentina" },
    { id: "es-CO-GonzaloNeural", name: "Gonzalo", gender: "M", accent: "Colombia" },
  ],
  en: [
    { id: "en-US-GuyNeural",     name: "Guy",     gender: "M", accent: "US" },
    { id: "en-US-JennyNeural",   name: "Jenny",   gender: "F", accent: "US" },
    { id: "en-GB-RyanNeural",    name: "Ryan",    gender: "M", accent: "UK" },
    { id: "en-GB-SoniaNeural",   name: "Sonia",   gender: "F", accent: "UK" },
    { id: "en-AU-NatashaNeural", name: "Natasha", gender: "F", accent: "AU" },
    { id: "en-AU-WilliamNeural", name: "William", gender: "M", accent: "AU" },
  ],
} as const;

export interface FormatOption {
  id: AudioFormat;
  label: string;
  desc: string;
}

export const FORMATS: readonly FormatOption[] = [
  { id: "mp3",  label: "MP3",  desc: "Comprimido, universal" },
  { id: "wav",  label: "WAV",  desc: "Sin pérdida, mayor tamaño" },
  { id: "ogg",  label: "OGG",  desc: "Comprimido, código abierto" },
  { id: "flac", label: "FLAC", desc: "Sin pérdida, comprimido" },
] as const;

export const ALL_VOICES: readonly Voice[] = [...VOICES.es, ...VOICES.en];
