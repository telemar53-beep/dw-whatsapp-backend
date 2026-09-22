import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { patchAiTriageConfig } from '../../../services/api';
import { descreverErro } from '../../../utils/errorMessages';

function fromConfig(config) {
  return {
    confidencePercent: config.triageConfidenceThreshold == null ? 80 : Math.round(config.triageConfidenceThreshold * 100),
    maxQuestions: config.triageMaxQuestions == null ? 2 : config.triageMaxQuestions,
    timeoutMinutes: config.triageTimeoutMinutes == null ? 3 : config.triageTimeoutMinutes,
    extraInstructions: config.triageExtraInstructions || '',
    resolvedReasonId: config.triageResolvedReasonId || '',
    readReceiptsDaytime: Boolean(config.triageReadReceiptsDaytime),
    // Sem valor salvo, o campo nasce vazio: "20:00"/"08:00" eram só sugestão
    // de placeholder em NightModePage, mas qualquer save() nas outras duas
    // páginas (que não mostram a janela) já gravava esse padrão sem o admin
    // ter escolhido nada — o canal achava a janela "definida" sem ser.
    nightStart: config.nightStartTime || '',
    nightEnd: config.nightEndTime || '',
  };
}

export const CAMPOS_DA_TRIAGEM = ['confidencePercent', 'maxQuestions', 'timeoutMinutes', 'extraInstructions', 'resolvedReasonId'];
export const CAMPOS_DO_NOTURNO = ['nightStart', 'nightEnd'];
export const CAMPOS_DA_IDENTIFICACAO = ['readReceiptsDaytime'];
const TODOS_OS_CAMPOS = [...CAMPOS_DA_TRIAGEM, ...CAMPOS_DO_NOTURNO, ...CAMPOS_DA_IDENTIFICACAO];

// Cada campo do formulário e o par [coluna do backend, valor]. Vazio em
// `resolvedReasonId` e nas horas é DESLIGAR, e por isso vira null de
// propósito; vazio em `extraInstructions` é texto vazio mesmo. `false` e `0`
// passam inteiros: quem decide o que é ausente é a chave não estar no objeto,
// nunca o valor ser falsy.
const PARA_O_BACKEND = {
  confidencePercent: (v) => ['triageConfidenceThreshold', Number(v) / 100],
  maxQuestions: (v) => ['triageMaxQuestions', Number(v)],
  timeoutMinutes: (v) => ['triageTimeoutMinutes', Number(v)],
  extraInstructions: (v) => ['triageExtraInstructions', v],
  resolvedReasonId: (v) => ['triageResolvedReasonId', v || null],
  nightStart: (v) => ['nightStartTime', v || null],
  nightEnd: (v) => ['nightEndTime', v || null],
  readReceiptsDaytime: (v) => ['triageReadReceiptsDaytime', v],
};

// Três páginas editam pedaços diferentes da MESMA linha de `ai_config`.
// Enquanto o backend só tinha update total, save() precisava mandar as oito
// colunas sempre — e mandar as oito significa mandar o que esta página
// carregou, revertendo em silêncio o que outra pessoa mudou no meio. A
// mitigação era reler tudo no instante do save, o que encurtava a janela de
// sobreposição para milissegundos sem eliminá-la.
//
// Com o PATCH parcial, cada página manda SÓ os campos que ela edita e o
// backend não encosta nas outras colunas. A releitura saiu junto: não havia
// mais o que preservar, e ela custava uma chamada a cada save.
export function useAiTriageForm(camposProprios = TODOS_OS_CAMPOS) {
  const { token } = useAuth();
  const { config, status, refresh } = useAiConfig();
  const [values, setValues] = useState(() => fromConfig(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setValues(fromConfig(config)); }, [config]);

  const setValue = useCallback((key, value) => setValues((prev) => ({ ...prev, [key]: value })), []);

  const donoDaJanelaNoturna = CAMPOS_DO_NOTURNO.every((campo) => camposProprios.includes(campo));

  async function save() {
    setError(null);
    // Meia janela só é problema de quem edita a janela. As outras páginas nem
    // mandam esses campos, então não têm como gravar metade.
    if (donoDaJanelaNoturna && Boolean(values.nightStart) !== Boolean(values.nightEnd)) {
      setError('Informe início e fim do atendimento noturno, ou deixe os dois vazios');
      return false;
    }
    setSaving(true);
    try {
      const payload = {};
      for (const campo of camposProprios) {
        const [coluna, valor] = PARA_O_BACKEND[campo](values[campo]);
        payload[coluna] = valor;
      }

      await patchAiTriageConfig(payload, token);
      refresh();
      return true;
    } catch (err) {
      setError(descreverErro(err, 'Falha ao salvar'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { status, config, values, setValue, save, saving, error, refresh };
}
