# Chunking de Texto Largo

## Por que chunking

Tanto Edge-TTS como XTTS v2 tienen limitaciones con textos muy largos:
- Edge-TTS puede fallar o producir audio cortado con textos > 5000 chars
- XTTS v2 degrada la calidad y consume mas VRAM con textos largos
- La generacion de un bloque enorme tarda mucho sin feedback

La solucion: dividir el texto en segmentos manejables, sintetizar cada uno, y concatenarlos.

## Algoritmo de division

```python
def split_into_chunks(text: str, max_chars: int = 3000) -> list[str]:
```

### Paso 1: Verificar si hace falta

```
Si len(text) <= max_chars → devolver [text] sin dividir
```

### Paso 2: Dividir por parrafos

```
"Parrafo uno.\n\nParrafo dos.\n\nParrafo tres."
                    ↓
["Parrafo uno.", "Parrafo dos.", "Parrafo tres."]
```

Se usa `re.split(r"\n\s*\n", text)` — doble salto de linea con espacios opcionales.

### Paso 3: Parrafos largos → dividir por frases

Si un parrafo individual excede `max_chars`:

```
"Frase uno. Frase dos. Frase tres. ... Frase veinte."
                    ↓
Se divide por: (?<=[.!?…;])\s+
(despues de punto, exclamacion, interrogacion, puntos suspensivos, punto y coma)
                    ↓
Se agrupan frases consecutivas hasta llenar max_chars:
["Frase uno. Frase dos. Frase tres.",
 "Frase cuatro. Frase cinco. Frase seis.",
 ...]
```

### Paso 4: Agrupacion inteligente

Las frases cortas se agrupan para minimizar el numero de chunks:

```
Frases: ["Hola.", "Que tal.", "Bien.", "Y tu.", ...]
max_chars = 100

Chunk 1: "Hola. Que tal. Bien. Y tu."  (27 chars, cabe mas)
→ Sigue agrupando hasta que la siguiente frase no cabe
```

### Regla de oro

**Nunca se corta a mitad de frase.** El peor caso es un chunk con una sola frase muy larga, pero eso es preferible a cortar una oracion por la mitad.

## Ejemplo con un relato

Texto de entrada: 70.000 caracteres, ~11.000 palabras

```
Parrafo 1 (800 chars)  → Chunk 1
Parrafo 2 (2100 chars) → Chunk 2
Parrafo 3 (4500 chars) → Chunk 3 (frase 1-8) + Chunk 4 (frase 9-15)
Parrafo 4 (1200 chars) → Chunk 5
...
Total: ~25 chunks
```

## Concatenacion

Despues de sintetizar cada chunk, se concatenan con pydub:

```python
# Edge-TTS: 400ms de pausa entre chunks
pause = AudioSegment.silent(duration=400)

# XTTS v2: 500ms de pausa (voz clonada suena mejor con mas espacio)
pause = AudioSegment.silent(duration=500)

combined = AudioSegment.empty()
for chunk in chunks:
    if not first:
        combined += pause
    combined += chunk
```

### Por que pausas diferentes

- **Edge-TTS (400ms)**: las voces neuronales de Microsoft ya incluyen silencios naturales al final de cada fragmento. 400ms evita que suene "pegado".
- **XTTS v2 (500ms)**: la voz clonada tiende a empezar cada chunk de forma abrupta. 500ms da un respiro mas natural entre parrafos.

## Optimizacion: bypass para texto corto

Cuando hay 1 solo chunk y el formato es MP3:

```python
if len(temp_files) == 1 and request.output_format == "mp3":
    temp_files[0].replace(output_path)  # Mueve sin procesar
```

Esto evita usar pydub/ffmpeg completamente. El archivo MP3 de Edge-TTS se sirve tal cual.

## Configuracion

```env
VOXFORGE_CHUNK_MAX_CHARS=3000   # Tamano maximo por chunk
VOXFORGE_MAX_TEXT_LENGTH=500000  # Limite total de texto
```

El limite de 3000 chars por chunk es un balance entre:
- Calidad (chunks mas grandes = mejor prosodia)
- Fiabilidad (chunks mas pequenos = menos probabilidad de fallo)
- VRAM (chunks mas grandes = mas consumo en XTTS v2)
