from fastapi import FastAPI

app = FastAPI(title="Voice Web Agent Brain")

@app.get("/health")
def health():
    return {"status": "ok", "service": "brain", "version": "0.1.0"}
