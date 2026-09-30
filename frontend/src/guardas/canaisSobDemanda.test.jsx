import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import ChannelsListPage from '../pages/settings/channels/ChannelsListPage';
import ChannelDetailPage from '../pages/settings/channels/ChannelDetailPage';
import ChannelConnectionTab from '../pages/settings/channels/ChannelConnectionTab';
import { useAuth } from '../contexts/AuthContext';
import { useChannels } from '../hooks/useChannels';
import { useTriage } from '../hooks/useTriage';
import { useAiConfig } from '../hooks/useAiConfig';

// Guarda de Números conectados (Fatia S2).
//
// A lista e o detalhe não podem pagar pelos diálogos: "Adicionar canal" e as
// credenciais da Meta (Migrar/Atualizar) chegam quando são abertos, com o CSS
// e o campo secreto deles. E a S2 usa só os ícones da família DW aprovados na
// S1, ou texto — nada da família antiga (WaIcons), das marcas de terceiros, de
// svg desenhado à mão nem de regra que esconda ícone por CSS.
//
// Duas provas, como em sgpSobDemanda.test.jsx:
//  1. LEITURA: imports estáticos e dinâmicos, ícones e folhas da pasta.
//  2. EFEITO: abrir a lista e o detalhe não avalia os diálogos; o clique sim.

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const CANAIS = join(RAIZ, 'pages/settings/channels');
const ler = (relativo) => readFileSync(join(RAIZ, relativo), 'utf8');
// O trecho antes do `from` não atravessa aspas nem ponto e vírgula: assim um
// `import './x.css';` sem `from` não engole o import da linha seguinte.
function importsEstaticos(fonte) {
  const limpa = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...limpa.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}
const importsDinamicos = (fonte) => [...fonte.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
const codigoDaPasta = () => readdirSync(CANAIS).filter((n) => /\.(js|jsx)$/.test(n) && !/\.test\./.test(n));
const folhasDaPasta = () => readdirSync(CANAIS).filter((n) => /\.css$/.test(n));

const avaliados = vi.hoisted(() => new Set());
vi.mock('../pages/settings/channels/AdicionarCanalDialog', async (original) => {
  avaliados.add('adicionar');
  return original();
});
vi.mock('../pages/settings/channels/CredenciaisMetaDialog', async (original) => {
  avaliados.add('credenciais');
  return original();
});
vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useChannels');
vi.mock('../hooks/useTriage');
vi.mock('../hooks/useAiConfig');
vi.mock('../services/api');

// Dados fictícios.
const suporte = { id: 'c1', type: 'baileys', name: 'Canal Suporte', phoneNumber: '+5500900000001', status: 'connected', hidden: false };

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'tok', agent: { role: 'admin' } });
  useChannels.mockReturnValue({ channels: [suporte], status: 'ready', refresh: vi.fn() });
  useTriage.mockReturnValue({ config: {}, options: [], status: 'ready', refresh: vi.fn() });
  useAiConfig.mockReturnValue({ config: { configured: true, mode: 'assistant' }, status: 'ready', refresh: vi.fn() });
});

describe('Números conectados: diálogos sob demanda (leitura)', () => {
  test('a lista só importa "Adicionar canal" sob demanda', () => {
    const fonte = ler('pages/settings/channels/ChannelsListPage.jsx');
    expect(importsEstaticos(fonte)).not.toContain('./AdicionarCanalDialog');
    expect(importsDinamicos(fonte)).toContain('./AdicionarCanalDialog');
  });

  test('o detalhe só importa as credenciais da Meta sob demanda', () => {
    const fonte = ler('pages/settings/channels/ChannelDetailPage.jsx');
    expect(importsEstaticos(fonte)).not.toContain('./CredenciaisMetaDialog');
    expect(importsDinamicos(fonte)).toContain('./CredenciaisMetaDialog');
  });

  test('ninguém mais importa os diálogos, o campo secreto ou a folha deles de forma estática', () => {
    const soDosDialogos = ['./AdicionarCanalDialog', './CredenciaisMetaDialog', './CampoSecreto', './formulario-do-canal.css'];
    const donos = { './CampoSecreto': ['AdicionarCanalDialog.jsx', 'CredenciaisMetaDialog.jsx'], './formulario-do-canal.css': ['AdicionarCanalDialog.jsx', 'CredenciaisMetaDialog.jsx'] };
    codigoDaPasta().forEach((nome) => {
      const estaticos = importsEstaticos(readFileSync(join(CANAIS, nome), 'utf8'));
      soDosDialogos.forEach((alvo) => {
        if ((donos[alvo] || []).includes(nome)) return;
        expect(estaticos, `${nome} importa ${alvo}`).not.toContain(alvo);
      });
    });
  });
});

describe('Números conectados: só a família DW aprovada, ou texto (leitura)', () => {
  const APROVADOS = new Set(['IconeBuscar', 'IconeCanais', 'IconeRecolher', 'IconeSemAcesso']);

  test('nenhum import da família antiga, de marca ou de biblioteca de ícones', () => {
    const arquivos = [...codigoDaPasta().map((n) => join(CANAIS, n)), join(RAIZ, 'pages/settings/SettingsShell.jsx')];
    arquivos.forEach((arquivo) => {
      importsEstaticos(readFileSync(arquivo, 'utf8')).forEach((caminho) => {
        expect(caminho, arquivo).not.toMatch(/components\/icons\/|WaIcons|SgpIcons|assets\/brands|lucide|ChannelVisuals/);
      });
    });
  });

  test('os ícones que entram são os aprovados na S1', () => {
    codigoDaPasta().forEach((nome) => {
      const fonte = readFileSync(join(CANAIS, nome), 'utf8');
      const deIcones = [...fonte.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*components\/icones[^']*'/g)];
      deIcones.forEach((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((icone) => {
        expect(APROVADOS.has(icone), `${nome}: ${icone}`).toBe(true);
      }));
    });
  });

  test('sem svg desenhado à mão e sem regra que esconda ícone por CSS', () => {
    codigoDaPasta().forEach((nome) => {
      expect(readFileSync(join(CANAIS, nome), 'utf8'), nome).not.toMatch(/<svg[\s>]/);
    });
    folhasDaPasta().forEach((nome) => {
      const folha = readFileSync(join(CANAIS, nome), 'utf8');
      expect(folha, nome).not.toMatch(/(svg|-icon|channel-brand)[^{}]*\{[^}]*display:\s*none/);
      expect(folha, nome).not.toMatch(/backdrop-filter|linear-gradient|radial-gradient/);
    });
  });

  // `.cfg-area` é o grupo do diretório lateral da S1 (settings.css dá 18 px
  // entre dois deles). Reusado nas seções do detalhe, desalinhava as colunas.
  test('as seções do canal não reusam a classe do diretório da S1', () => {
    [...codigoDaPasta(), ...folhasDaPasta()].forEach((nome) => {
      expect(readFileSync(join(CANAIS, nome), 'utf8'), nome).not.toMatch(/\bcfg-area\b/);
    });
  });

  // O emblema é um <span>: uma regra "span" solta no bloco que o contém pinta
  // "API"/"BSP" de cinza sobre o índigo (2,2:1, medido nos diálogos).
  test('o texto do resumo nos diálogos não alcança o span do emblema', () => {
    folhasDaPasta().forEach((nome) => {
      const folha = readFileSync(join(CANAIS, nome), 'utf8');
      expect(folha, nome).not.toMatch(/\.(cfg-dlg-canal-resumo|cfg-form-intro) span/);
    });
  });

  test('as regras antigas de canal saíram de overlays.css e settings.css', () => {
    expect(ler('components/overlays.css')).not.toMatch(/\.dialog-provider-|\.dialog-channel-/);
    expect(ler('components/overlays.css')).toMatch(/@media\(max-width:600px\)\{\.dw-dialog\{max-height:calc\(100dvh - 24px\)\}\}/);
    expect(ler('pages/settings/settings.css')).not.toMatch(/\.channel-(connection-page|section|data-|inline-|related-link|advanced)|\.settings-channel-|channel-detail-title/);
  });
});

// Os dois abaixo dependem da ordem: cada módulo é avaliado uma vez só.
describe('Números conectados: diálogos sob demanda (efeito)', () => {
  test('abrir a lista não avalia "Adicionar canal"; o clique traz', async () => {
    const ctx = { openProfile: vi.fn(), closeMobileNav: vi.fn(), profileVersion: 0 };
    render(
      <MemoryRouter initialEntries={['/configuracoes/canais']}>
        <Routes>
          <Route element={<Outlet context={ctx} />}>
            <Route path="/configuracoes/canais" element={<ChannelsListPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Canal Suporte' })).toBeInTheDocument();
    expect(avaliados.has('adicionar')).toBe(false);
    expect(avaliados.has('credenciais')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    expect(await screen.findByRole('dialog', { name: 'Adicionar canal' })).toBeInTheDocument();
    expect(avaliados.has('adicionar')).toBe(true);
    expect(avaliados.has('credenciais')).toBe(false);
  });

  test('abrir o detalhe não avalia as credenciais; "Migrar para Meta Cloud" traz', async () => {
    render(
      <MemoryRouter initialEntries={['/configuracoes/canais/c1/conexao']}>
        <Routes>
          <Route path="/configuracoes/canais/:id" element={<ChannelDetailPage />}>
            <Route path="conexao" element={<ChannelConnectionTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Canal Suporte' })).toBeInTheDocument();
    expect(avaliados.has('credenciais')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Migrar para Meta Cloud' }));
    expect(await screen.findByRole('dialog', { name: /Migrar para Meta Cloud\?/ })).toBeInTheDocument();
    expect(avaliados.has('credenciais')).toBe(true);
  });
});
