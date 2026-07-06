#!/usr/bin/env python3
"""
WaxPrep Tutor — Modal Deployment Script
Deploys Qwen3.6-35B-A3B on Modal with vLLM for fast inference

Usage:
    modal deploy modal_deploy.py

Requirements:
    pip install modal
    modal token new   # Authenticate with Modal
"""

import modal

app = modal.App("waxprep-tutor-model")

# Container image with vLLM (optimized inference engine)
image = (
    modal.Image.debian_slim()
    .pip_install([
        "vllm>=0.5.0",
        "transformers>=4.40.0",
        "torch>=2.3.0",
        "accelerate",
        "huggingface_hub",
        "fastapi>=0.110.0",
        "uvicorn",
    ])
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# GPU configuration — A100-40GB is sufficient for Qwen3.6-35B-A3B (MoE)
# Only ~3.5B parameters active at once, fits comfortably in 40GB
GPU_CONFIG = modal.gpu.A100(count=1, size="40GB")

@app.cls(
    gpu=GPU_CONFIG,
    image=image,
    container_idle_timeout=300,   # Keep warm for 5 minutes
    timeout=600,                   # 10 minute timeout
    scaledown_window=300,
)
class QwenTutorModel:
    """Serverless Qwen3.6-35B-A3B model serving for WaxPrep Tutor"""

    @modal.enter()
    def load_model(self):
        """Load model once when container starts (warm start)"""
        from vllm import LLM, SamplingParams
        import torch

        print("Loading Qwen3.6-35B-A3B model...")

        self.model = LLM(
            model="Qwen/Qwen3.6-35B-A3B",
            tensor_parallel_size=1,
            gpu_memory_utilization=0.90,
            max_model_len=32768,         # 32K context for efficiency
            trust_remote_code=True,
            dtype="auto",
            swap_space=4,
        )

        # Default sampling params
        self.default_params = SamplingParams(
            temperature=0.7,
            top_p=0.9,
            max_tokens=1024,
            stop=["<|im_end|>", "<|endoftext|>"],
        )

        print("Model loaded successfully!")

    @modal.method()
    def generate(self, messages: list, mode: str = "balanced") -> dict:
        """
        Generate response with dynamic reasoning mode.

        Args:
            messages: OpenAI-format message list [{"role": "user", "content": "..."}]
            mode: 'fast', 'balanced', or 'accurate'
        """
        from vllm import SamplingParams

        # Adjust sampling based on mode
        if mode == "fast":
            params = SamplingParams(
                temperature=0.5,
                top_p=0.85,
                max_tokens=256,
                stop=["<|im_end|>", "<|endoftext|>"],
            )
        elif mode == "accurate":
            params = SamplingParams(
                temperature=0.3,
                top_p=0.95,
                max_tokens=2048,
                stop=["<|im_end|>", "<|endoftext|>"],
            )
        else:  # balanced
            params = self.default_params

        # Generate
        outputs = self.model.chat(messages, sampling_params=params)

        return {
            "text": outputs[0].outputs[0].text,
            "usage": {
                "prompt_tokens": len(outputs[0].prompt_token_ids),
                "completion_tokens": len(outputs[0].outputs[0].token_ids),
            },
            "mode": mode,
            "model": "Qwen/Qwen3.6-35B-A3B",
        }

    @modal.method()
    def health(self) -> dict:
        """Health check endpoint"""
        return {
            "status": "healthy",
            "model": "Qwen/Qwen3.6-35B-A3B",
            "type": "Mixture-of-Experts (3.5B active)",
        }


# ═══════════════════════════════════════════════════════════════
# FASTAPI WEB ENDPOINT (for direct HTTP access)
# ═══════════════════════════════════════════════════════════════

from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict

web_app = FastAPI(title="WaxPrep Model API")

class GenerateRequest(BaseModel):
    messages: List[Dict[str, str]]
    mode: str = "balanced"

class GenerateResponse(BaseModel):
    text: str
    usage: Dict[str, int]
    mode: str
    model: str

@web_app.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest):
    """Generate text using Qwen model"""
    model = QwenTutorModel()
    result = await model.generate.remote.aio(
        messages=request.messages,
        mode=request.mode,
    )
    return GenerateResponse(**result)

@web_app.get("/health")
async def health():
    """Health check"""
    model = QwenTutorModel()
    return await model.health.remote.aio()

# Deploy as web endpoint
@app.function(image=image, gpu=GPU_CONFIG)
@modal.asgi_app()
def fastapi_app():
    return web_app


if __name__ == "__main__":
    print("Deploy with: modal deploy modal_deploy.py")
