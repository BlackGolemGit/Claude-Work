# Offline LLM Server

A fully offline, LAN-accessible LLM chat server with multi-user support, per-user chat history, RAG document context, and a dual UI (user chat + admin panel).

## Features

- **Offline** — no internet required after initial model download
- **Multi-user** — JWT authentication, per-user private chat history
- **RAG** — upload PDFs, images, and text files; all chats can use them as context
- **Admin panel** — user management, document uploads, system stats
- **Streaming** — real-time streamed responses from Ollama
- **LAN accessible** — connect any device on the same network

## Prerequisites

| Requirement | Install |
|-------------|---------|
| Python 3.11+ | System package manager |
| [Ollama](https://ollama.com) | `curl -fsSL https://ollama.com/install.sh \| sh` |
| Tesseract OCR | `sudo apt install tesseract-ocr tesseract-ocr-eng` |
| ~4 GB disk (model) | — |

## Setup

### 1. Clone and install

```bash
git clone <repo-url> && cd Claude-Work
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
nano .env   # set SECRET_KEY and ADMIN_PASSWORD
```

Generate a secure `SECRET_KEY`:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 3. Start

```bash
bash start.sh
```

On first run the script will:
- Start Ollama
- Pull the default model (`llama3.2:3b-instruct-q4_K_M`, ~2 GB)
- Create the SQLite database and admin account
- Start the FastAPI server

## Access

| Interface | URL |
|-----------|-----|
| Chat UI | `http://<server-ip>:8000/` |
| Admin UI | `http://<server-ip>:8000/admin/` |
| API docs | `http://<server-ip>:8000/docs` |

**Default admin login:** Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`.

## LAN Setup

1. Connect clients to the same network (Ethernet or Wi-Fi)
2. Find the server IP: `hostname -I | awk '{print $1}'`
3. Clients open `http://<server-ip>:8000/` in a browser

For direct cable connection: use a crossover Ethernet cable or a USB-Ethernet adapter configured with a static IP on both machines.

## Models

The server uses [Ollama](https://ollama.com/library) for inference. Recommended models for CPU-only use:

| Model | Size | RAM needed |
|-------|------|-----------|
| `llama3.2:3b-instruct-q4_K_M` | 2.1 GB | 8 GB |
| `mistral:7b-instruct-q4_K_M` | 4.1 GB | 12 GB |

Change model via `.env`:
```
DEFAULT_MODEL=mistral:7b-instruct-q4_K_M
```

Or pull additional models with `ollama pull <model>` and select them per-conversation in the chat UI.

## Document Types Supported

| Type | Processing |
|------|-----------|
| PDF | Text extraction via pypdf |
| PNG / JPG / GIF / WebP / TIFF | OCR via Tesseract |
| TXT / MD / CSV | Direct read |

Max upload size: 50 MB per file (configurable in `.env`).

## Configuration Reference

All settings in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | *required* | JWT signing key |
| `ADMIN_USERNAME` | `admin` | Bootstrap admin username |
| `ADMIN_PASSWORD` | *required* | Bootstrap admin password |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8000` | Port |
| `DEFAULT_MODEL` | `llama3.2:3b-instruct-q4_K_M` | Ollama model |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_TIMEOUT` | `120` | Response timeout (seconds) |
| `RAG_TOP_K` | `5` | Max context chunks to retrieve |
| `CHUNK_SIZE` | `512` | Words per chunk |
| `CHUNK_OVERLAP` | `64` | Overlap between chunks |

## Project Structure

```
backend/          FastAPI app (models, routers, services)
frontend/
  client/         User chat UI (vanilla HTML/CSS/JS)
  admin/          Admin panel UI
data/
  uploads/        Raw uploaded files
  vectordb/       ChromaDB vector store
  llm_server.db  SQLite database
start.sh          Startup script
requirements.txt  Python dependencies
```

## Architecture Notes

- **Single worker** (`--workers 1`) required — the embedding model and ChromaDB client are singletons not safe for multiprocessing
- **RAG** uses `all-MiniLM-L6-v2` embeddings via sentence-transformers; ChromaDB stores them on disk
- **Streaming** uses `fetch` + `ReadableStream` (not `EventSource`) so `Authorization` headers can be sent
- **SQLite WAL mode** enabled for concurrent read/write performance
