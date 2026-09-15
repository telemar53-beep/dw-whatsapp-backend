import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { updateAiTriageConfig } from '../../../services/api';

function fromConfig(config) {
  return {
    confidencePercent: config.triageConfidenceThreshold == null ? 80 : Math.round(config.triageConfidenceThreshold * 100),
    maxQuestions: config.triageMaxQuestions == null ? 2 : config.triageMaxQuestions,
    timeoutMinutes: config.triageTimeoutMinutes == null ? 3 : config.triageTimeoutMinutes,
    extraInstructions: config.triageExtraInstructions || '',
    resolvedReasonId: config.triageResolvedReasonId || '',
    requireBirthdate: Boolean(config.triageRequireBirthdate),
    readReceiptsDaytime: Boolean(config.triageReadReceiptsDaytime),
    // Sem valor salvo, o campo nasce vazio: "20:00"/"08:00" eram só sugestão
    // de placeholder em NightModePage, mas qualquer save() nas outras duas
    // páginas (que não mostram a janela) já gravava esse padrão sem o admin
    // ter escolhido nada — o canal achava a janela "definida" sem ser.
    nightStart: config.nightStartTime || '',
    nightEnd: config.nightEndTime || '',
  };
}

// Três páginas editam pedaços diferentes da MESMA configuração, e o backend
// trata campo ausente como "desligado". Por isso save() manda os nove sempre.
export function useAiTriageForm() {
  const { token } = useAuth();
  const { config, status, refresh } = useAiConfig();
  const [values, setValues] = useState(() => fromConfig(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setValues(fromConfig(config)); }, [config]);

  const setValue = useCallback((key, value) => setValues((prev) => ({ ...prev, [key]: value })), []);

  async function save() {
    setError(null);
    if (Boolean(values.nightStart) !== Boolean(values.nightEnd)) {
      setError('Informe início e fim do atendimento noturno, ou deixe os dois vazios');
      return false;
    }
    setSaving(true);
    try {
      await updateAiTriageConfig(
        {
          triageConfidenceThreshold: Number(values.confidencePercent) / 100,
          triageMaxQuestions: Number(values.maxQuestions),
          triageTimeoutMinutes: Number(values.timeoutMinutes),
          triageExtraInstructions: values.extraInstructions,
          triageResolvedReasonId: values.resolvedReasonId || null,
          nightStartTime: values.nightStart || null,
          nightEndTime: values.nightEnd || null,
          triageRequireBirthdate: values.requireBirthdate,
          triageReadReceiptsDaytime: values.readReceiptsDaytime,
        },
        token
      );
      refresh();
      return true;
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { status, config, values, setValue, save, saving, error, refresh };
}
