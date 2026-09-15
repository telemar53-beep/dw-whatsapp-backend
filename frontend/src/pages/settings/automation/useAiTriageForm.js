import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { updateAiTriageConfig } from '../../../services/api';

const NOTURNO_INICIO_PADRAO = '20:00';
const NOTURNO_FIM_PADRAO = '08:00';

function fromConfig(config) {
  return {
    confidencePercent: config.triageConfidenceThreshold == null ? 80 : Math.round(config.triageConfidenceThreshold * 100),
    maxQuestions: config.triageMaxQuestions == null ? 2 : config.triageMaxQuestions,
    timeoutMinutes: config.triageTimeoutMinutes == null ? 3 : config.triageTimeoutMinutes,
    extraInstructions: config.triageExtraInstructions || '',
    resolvedReasonId: config.triageResolvedReasonId || '',
    requireBirthdate: Boolean(config.triageRequireBirthdate),
    readReceiptsDaytime: Boolean(config.triageReadReceiptsDaytime),
    nightStart: config.nightStartTime || NOTURNO_INICIO_PADRAO,
    nightEnd: config.nightEndTime || NOTURNO_FIM_PADRAO,
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
