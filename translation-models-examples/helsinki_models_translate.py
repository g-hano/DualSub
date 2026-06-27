from transformers import pipeline
source = "en"
target = "fr"
input_text = "Hello, how are you?"
model = f"Helsinki-NLP/opus-mt-{source}-{target}"
pipe = pipeline("translation", model=model)
translation = pipe(input_text)