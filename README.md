# dw-whatsapp-backend

Sistema WhatsApp para DW Telecom - Backend Node.js

## Frontend

O frontend de atendimento fica em `frontend/` (projeto Vite/React separado, com seu próprio `package.json`).

Para rodar localmente:

```
cd frontend
npm install
npm run dev
```

Para build de produção, defina `VITE_API_BASE_URL` apontando para a URL do backend implantado (veja `frontend/.env.production.example`).

No backend, defina a variável de ambiente `FRONTEND_ORIGIN` com a URL onde o frontend está publicado (ex: um Render Static Site) — sem isso, o navegador bloqueia as requisições por CORS. Em desenvolvimento local, `http://localhost:5173` já é liberado automaticamente, sem precisar configurar nada.

Defina também `PUBLIC_BASE_URL` com a própria URL pública deste backend (sem barra no final — ex: a URL do serviço de backend no Render). Ela é usada para montar a URL de webhook registrada na 360dialog quando um canal 360dialog é criado. Precisa estar configurada no ambiente do Render ANTES do deploy deste branch, ou o backend falha ao iniciar.
