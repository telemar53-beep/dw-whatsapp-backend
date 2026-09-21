import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { getAiConfig, updateAiTriageConfig } from '../../../services/api';
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

// Três páginas editam pedaços diferentes da MESMA linha de `ai_config`, e o
// backend só tem update total: `UPDATE ... SET` das oito colunas, campo ausente
// vira null/false. Por isso save() precisa mandar as oito sempre.
//
// O efeito colateral disso é real: se outra pessoa (ou outra aba) mudar a
// Triagem depois que esta página carregou, salvar aqui reverte a Triagem para o
// valor antigo, em silêncio. `camposProprios` diz quais valores são desta tela;
// todos os outros são relidos do servidor no instante do save, e não do estado
// em cache. Isso ENCURTA a janela de sobreposição de minutos para milissegundos,
// mas NÃO a elimina — só um PATCH parcial no backend eliminaria, e isso está
// fora do escopo desta etapa.
export function useAiTriageForm(camposProprios = TODOS_OS_CAMPOS) {
  const { token } = useAuth();
  const { config, status, refresh } = useAiConfig();
  const [values, setValues] = useState(() => fromConfig(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setValues(fromConfig(config)); }, [config]);

  const setValue = useCallback((key, value) => setValues((prev) => ({ ...prev, [key]: value })), []);

  const donoDaJanelaNoturna = CAMPOS_DO_NOTURNO.every((campo) => camposProprios.includes(campo));
  // Só faz sentido reler quando existe campo que NÃO é desta tela: é ele que
  // corre o risco de ser revertido. Página que edita a configuração inteira
  // não tem nada de terceiros para preservar.
  const precisaReler = camposProprios.length < TODOS_OS_CAMPOS.length;

  async function save() {
    setError(null);
    if (donoDaJanelaNoturna && Boolean(values.nightStart) !== Boolean(values.nightEnd)) {
      setError('Informe início e fim do atendimento noturno, ou deixe os dois vazios');
      return false;
    }
    setSaving(true);
    try {
      let finais = values;
      if (precisaReler) {
        let atual;
        try {
          atual = await getAiConfig(token);
        } catch (err) {
          // Falhou conferir o estado atual: NÃO salvar com o cache antigo.
          // Gravar aqui poderia reverter, sem aviso, o que outra tela mudou.
          setError('Não foi possível conferir a configuração atual antes de salvar. Nada foi gravado — tente de novo.');
          return false;
        }
        // O que é desta tela vem do formulário; o resto vem do que o servidor
        // acabou de devolver.
        finais = { ...fromConfig(atual) };
        for (const campo of camposProprios) finais[campo] = values[campo];
      }

      await updateAiTriageConfig(
        {
          triageConfidenceThreshold: Number(finais.confidencePercent) / 100,
          triageMaxQuestions: Number(finais.maxQuestions),
          triageTimeoutMinutes: Number(finais.timeoutMinutes),
          triageExtraInstructions: finais.extraInstructions,
          triageResolvedReasonId: finais.resolvedReasonId || null,
          nightStartTime: finais.nightStart || null,
          nightEndTime: finais.nightEnd || null,
          triageReadReceiptsDaytime: finais.readReceiptsDaytime,
        },
        token
      );
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
