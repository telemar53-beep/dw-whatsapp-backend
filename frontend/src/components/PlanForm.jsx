import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createPlan, updatePlan } from '../services/api';
import { Button } from './ui';
import { WaError } from './WaDialog';
import { descreverErro } from '../utils/errorMessages';

const CAMPO =
  'h-10 w-full rounded-[10px] border border-wa-border bg-wa-field px-3.5 text-[14px] text-wa-text placeholder-wa-muted outline-none transition focus:border-accent/60';
const ROTULO = 'mb-1.5 block text-[13px] font-medium text-wa-muted';
const AJUDA = 'mt-1 text-[12.5px] leading-[17px] text-wa-muted';

// O operador brasileiro digita "100,50". O banco guarda NUMERIC e a API exige
// número — a conversão é aqui, na borda, e não vira texto formatado em lugar
// nenhum depois disso.
export function precoEmNumero(texto) {
  const limpo = String(texto ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (!limpo) return null;
  const numero = Number(limpo);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

// Em branco significa "plano sem velocidade" — null, nunca 0. Zero seria uma
// afirmação falsa sobre um plano de TV ou combo.
export function velocidadeEmNumero(texto) {
  const limpo = String(texto ?? '').trim();
  if (!limpo) return null;
  const numero = Number(limpo);
  return Number.isInteger(numero) && numero > 0 ? numero : undefined;
}

function precoParaCampo(valor) {
  if (valor === null || valor === undefined) return '';
  return Number(valor).toFixed(2).replace('.', ',');
}

// `embedded`: dentro de um pop-up que já tem título e moldura — sem borda nem h3.
function PlanForm({ plan = null, onSaved, onCancel, embedded = false }) {
  const { token } = useAuth();
  const editando = Boolean(plan);

  const [name, setName] = useState(plan?.name || '');
  const [speed, setSpeed] = useState(plan?.speedMbps == null ? '' : String(plan.speedMbps));
  const [price, setPrice] = useState(precoParaCampo(plan?.monthlyPrice));
  const [install, setInstall] = useState(plan?.installCondition || '');
  const [active, setActive] = useState(plan ? plan.active : true);
  const [order, setOrder] = useState(String(plan?.sortOrder ?? 0));
  const [note, setNote] = useState(plan?.note || '');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const monthlyPrice = precoEmNumero(price);
    if (monthlyPrice === null) {
      setError('Informe a mensalidade em reais, por exemplo 100,00.');
      return;
    }
    const speedMbps = velocidadeEmNumero(speed);
    if (speedMbps === undefined) {
      setError('A velocidade deve ser um número inteiro de megabits, ou ficar em branco.');
      return;
    }
    const sortOrder = Number(String(order).trim() || '0');
    if (!Number.isInteger(sortOrder)) {
      setError('A ordem de exibição deve ser um número inteiro.');
      return;
    }

    const payload = {
      name: name.trim(),
      speedMbps,
      monthlyPrice,
      installCondition: install.trim(),
      active,
      sortOrder,
      note: note.trim(),
    };

    setSubmitting(true);
    try {
      if (editando) {
        await updatePlan(plan.id, payload, token);
      } else {
        await createPlan(payload, token);
      }
      onSaved();
    } catch (err) {
      setError(descreverErro(err, editando ? 'Falha ao salvar o plano' : 'Falha ao cadastrar o plano'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={embedded ? '' : 'rounded-[16px] border border-wa-border bg-wa-surface p-4'}>
      {!embedded && (
        <h3 className="mb-2.5 text-[13.5px] font-medium text-wa-text">
          {editando ? 'Editar plano' : 'Cadastrar novo plano'}
        </h3>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="plan-name" className={ROTULO}>Nome</label>
          <input
            id="plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="500 Mega"
            className={CAMPO}
            required
          />
          <p className={AJUDA}>O nome comercial, como o cliente ouve.</p>
        </div>

        <div className="flex flex-wrap gap-3.5">
          <div className="min-w-[150px] flex-1">
            <label htmlFor="plan-speed" className={ROTULO}>Velocidade (Mbps)</label>
            <input
              id="plan-speed"
              inputMode="numeric"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              placeholder="500"
              className={CAMPO}
            />
            <p className={AJUDA}>Em branco para plano sem velocidade, como TV.</p>
          </div>
          <div className="min-w-[150px] flex-1">
            <label htmlFor="plan-price" className={ROTULO}>Mensalidade (R$)</label>
            <input
              id="plan-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="100,00"
              className={CAMPO}
            />
            {/* Sem `required` nativo de propósito: o balão do navegador diria
                só "preencha este campo", e aqui o que confunde é o FORMATO.
                A validação própria explica a vírgula decimal. */}
          </div>
        </div>

        <div className="flex flex-wrap gap-3.5">
          <div className="min-w-[150px] flex-1">
            <label htmlFor="plan-install" className={ROTULO}>Condição de instalação</label>
            <input
              id="plan-install"
              value={install}
              onChange={(e) => setInstall(e.target.value)}
              placeholder="Grátis"
              className={CAMPO}
            />
          </div>
          <div className="min-w-[110px] max-w-[160px] flex-1">
            <label htmlFor="plan-order" className={ROTULO}>Ordem de exibição</label>
            <input
              id="plan-order"
              inputMode="numeric"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className={CAMPO}
            />
          </div>
        </div>

        <div>
          <label htmlFor="plan-note" className={ROTULO}>Observação interna</label>
          <textarea
            id="plan-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${CAMPO} h-auto py-2.5`}
          />
          <p className={AJUDA}>
            Uso interno da equipe. Nunca é enviada ao cliente nem à assistente virtual.
          </p>
        </div>

        <label htmlFor="plan-active" className="flex items-center gap-2.5 text-[14px] text-wa-text">
          <input
            id="plan-active"
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Plano ativo
        </label>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} type="button">
              Cancelar
            </Button>
          )}
          <Button type="submit" loading={submitting}>
            Salvar
          </Button>
        </div>
      </form>
      {error && <WaError className="mt-2">{error}</WaError>}
    </div>
  );
}

export default PlanForm;
