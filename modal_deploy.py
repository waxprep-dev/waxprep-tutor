import modal
import os

app = modal.App("waxprep-tutor")

# Replace with your actual HF token
HF_TOKEN = "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"

image = modal.Image.debian_slim().pip_install(
    "transformers",
    "torch",
    "accelerate",
    "huggingface_hub",
    "fastapi[standard]"
).env({"HF_TOKEN": HF_TOKEN}).run_commands(
    "python -c \"from transformers import AutoModelForCausalLM, AutoTokenizer; "
    "AutoTokenizer.from_pretrained('Qwen/Qwen2.5-1.5B-Instruct', trust_remote_code=True); "
    "AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-1.5B-Instruct', trust_remote_code=True)\""
)

@app.function(
    image=image,
    gpu="T4",
    timeout=600,
)
def run_qwen(prompt: str):
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch

    model_name = "Qwen/Qwen2.5-1.5B-Instruct"

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    outputs = model.generate(**inputs, max_new_tokens=512)
    return tokenizer.decode(outputs[0], skip_special_tokens=True)

@app.function(
    image=image,
    gpu="T4",
    timeout=600,
)
@modal.fastapi_endpoint(method="POST")
def generate(request: dict):
    prompt = request.get("prompt", "Hello, how are you?")
    return {"response": run_qwen.remote(prompt)}
