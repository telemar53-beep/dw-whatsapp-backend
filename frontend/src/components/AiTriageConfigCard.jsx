import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAiConfig } from '../hooks/useAiConfig';
import { useReasons } from '../hooks/useReasons';
import { updateAiTriageConfig } from '../services/api';

const inputClass =
  'w-full rounded-xl border border-wa-border bg-wa-field px-3.5 py-2.5 text-wa-text outline-none transition focus:border-wa-green/60 focus:bg-wa-panel focus:ring-2 focus:ring-wa-green/25';
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-muted';
const cardClass = 'space-y-3 rounded-2xl border border-wa-surface-line bg-wa-surface p-6 shadow-[0_20px_50px_-25px_rgba(15,35,60,0.35)] backdrop-blur-xl';
// Padrão da spec do modo noturno. Com a config vazia (banco sem janela) os
// campos nascem preenchidos: dois campos em branco faziam o admin ligar o
// interruptor do canal achando que bastava, e o noturno nunca ativava.
const NOTURNO_INICIO_PADRAO = '20:00';
const NOTURNO_FIM_PADRAO = '08:00';

function AiTriageConfigCard() {
  const { token } = useAuth();
  const { config, loading, refresh } = useAiConfig();
  const { reasons } = useReasons();
  const [confidencePercent, setConfidencePercent] = useState(80);
  const [maxQuestions, setMaxQuestions] = useState(2);
  const [timeoutMinutes, setTimeoutMinutes] = useState(3);
  const [extraInstructions, setExtraInstructions] = useState('');
  const [resolvedReasonId, setResolvedReasonId] = useState('');
  const [nightStart, setNightStart] = useState(NOTURNO_INICIO_PADRAO);
  const [nightEnd, setNightEnd] = useState(NOTURNO_FIM_PADRAO);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // A tela trabalha em porcentagem (0-100); o banco guarda a fração (0-1). A
  // conversão acontece só nas duas bordas: aqui ao carregar, e no handleSave
  // ao gravar.
  useEffect(() => {
    if (config.triageConfidenceThreshold !== undefined && config.triageConfidenceThreshold !== null) {
      setConfidencePercent(Math.round(config.triageConfidenceThreshold * 100));
    }
    if (config.triageMaxQuestions !== undefined && config.triageMaxQuestions !== null) {
      setMaxQuestions(config.triageMaxQuestions);
    }
    if (config.triageTimeoutMinutes !== undefined && config.triageTimeoutMinutes !== null) {
      setTimeoutMinutes(config.triageTimeoutMinutes);
    }
    setExtraInstructions(config.triageExtraInstructions || '');
    setResolvedReasonId(config.triageResolvedReasonId || '');
    setNightStart(config.nightStartTime || NOTURNO_INICIO_PADRAO);
    setNightEnd(config.nightEndTime || NOTURNO_FIM_PADRAO);
  }, [config]);

  async function handleSave(event) {
    event.preventDefault();
    setError(null);
    // Meia janela (só início ou só fim) não é janela: o backend recusa, e
    // avisar aqui poupa a viagem.
    if (Boolean(nightStart) !== Boolean(nightEnd)) {
      setError('Informe início e fim do atendimento noturno, ou deixe os dois vazios');
      return;
    }
    setSaving(true);
    try {
      await updateAiTriageConfig(
        {
          triageConfidenceThreshold: Number(confidencePercent) / 100,
          triageMaxQuestions: Number(maxQuestions),
          triageTimeoutMinutes: Number(timeoutMinutes),
          triageExtraInstructions: extraInstructions,
          // '' é "não encerrar": vai como null, que é o que desliga o
          // encerramento pela IA no backend.
          triageResolvedReasonId: resolvedReasonId || null,
          nightStartTime: nightStart || null,
          nightEndTime: nightEnd || null,
        },
        token
      );
      refresh();
    } catch (err) {
      setError((err.body && err.body.error) || 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={cardClass}>
      <h3 className="font-display text-base font-semibold text-wa-text">Triagem com IA</h3>
      <p className="text-sm text-wa-muted">
        Controla quando a IA se sente segura para responder sozinha e quantas perguntas ela pode
        fazer antes de encaminhar para um atendente.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="triage-confidence" className={labelClass}>Confiança mínima (%)</label>
          <input
            id="triage-confidence"
            type="number"
            min="0"
            max="100"
            value={confidencePercent}
            onChange={(e) => setConfidencePercent(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="triage-max-questions" className={labelClass}>Máximo de perguntas</label>
          <input
            id="triage-max-questions"
            type="number"
            min="0"
            max="5"
            value={maxQuestions}
            onChange={(e) => setMaxQuestions(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="triage-timeout" className={labelClass}>Tempo limite (minutos)</label>
          <input
            id="triage-timeout"
            type="number"
            min="1"
            max="60"
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="triage-resolved-reason" className={labelClass}>
          Encerrar sozinha depois de entregar boleto/PIX
        </label>
        <select
          id="triage-resolved-reason"
          value={resolvedReasonId}
          onChange={(e) => setResolvedReasonId(e.target.value)}
          className={inputClass}
        >
          <option value="">Não encerrar: encaminhar ao setor (padrão)</option>
          {reasons.map((reason) => (
            <option key={reason.id} value={reason.id}>{reason.name}</option>
          ))}
        </select>
        <p className="text-[12px] text-wa-muted">
          Com um motivo escolhido, a IA pergunta se o cliente precisa de mais algo e, se não,
          encerra o atendimento com esse motivo. Sem motivo, a conversa vai para a fila como hoje.
        </p>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="triage-night-start" className={labelClass}>
              Atendimento noturno com IA — início
            </label>
            <input
              id="triage-night-start"
              type="time"
              value={nightStart}
              onChange={(e) => setNightStart(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="triage-night-end" className={labelClass}>
              Atendimento noturno com IA — fim
            </label>
            <input
              id="triage-night-end"
              type="time"
              value={nightEnd}
              onChange={(e) => setNightEnd(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-[12px] text-wa-muted">
          Todos os dias, feriados incluídos. Ex.: 20:00 a 08:00. Salve a janela antes de ligar o
          interruptor "Atendimento noturno com IA" no canal: sem ela o canal recusa ligar.
        </p>
      </div>

      <div>
        <label htmlFor="triage-extra-instructions" className={labelClass}>Instruções adicionais</label>
        <textarea
          id="triage-extra-instructions"
          rows={3}
          value={extraInstructions}
          onChange={(e) => setExtraInstructions(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && (
        <p className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || loading}
          className="rounded-[12px] bg-wa-green px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-wa-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </form>
  );
}

export default AiTriageConfigCard;
