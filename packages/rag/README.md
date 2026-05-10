# Aether RAG — Hybrid Retrieval & Knowledge Indexing

RAG system for Aether: hybrid retrieval (keyword + vector), cross-encoder reranking,
smart chunking, AST-aware code indexing, and continuous repository watching.

## Architecture

```
Aether App (Electron)
       |
       | HTTP/gRPC
       v
   packages/rag/
   ├── chunker/       — Smart document chunking with overlap optimization
   ├── embeddings/    — Local sentence-transformers (no API keys)
   ├── retrievers/    — BM25 keyword, vector, and hybrid fusion
   ├── reranker/      — Cross-encoder reranking
   ├── code_index/    — AST-aware code indexing (Python, JS/TS, etc.)
   ├── watcher/       — Continuous file system watcher
   ├── store/         — Storage backends (JSON, SQLite, LanceDB)
   ├── api/           — High-level query/index/retrieve API
   └── main.py        — Entry point
```

## Quick Start

```bash
cd packages/rag
uv sync          # install dependencies
uv run python main.py --serve   # start as HTTP server
```

## License

MIT
