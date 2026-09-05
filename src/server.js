const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor WhatsApp rodando' });
});

app.get('/', (req, res) => {
  res.json({ message: 'API WhatsApp DW Telecom' });
});

app.listen(PORT, () => {
  console.log('Servidor rodando na porta ' + PORT);
});
