import { Link } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { Card, Field, Button, AsyncState, HelpText, inputClass } from '../../../components/ui';
import { useAiTriageForm } from './useAiTriageForm';
import { useChannels } from '../../../hooks/useChannels';

function NightModePage() {
  const form = useAiTriageForm();
  const { channels, status: channelsStatus } = useChannels(true);
  const noturnos = channels.filter((c) => c.aiNightModeEnabled);

  return (
    <SettingsPage title="Atendimento noturno" description="A janela em que a IA atende sozinha à noite, nos canais que tiverem o noturno ligado." scope="global">
      <Card title="Não confundir com o horário de atendimento" tone="default">
        <p className="text-[13.5px] text-wa-text">
          <Link to="/configuracoes/regras/horario" className="text-wa-link underline">Horário de atendimento</Link> define quando há atendente humano.
          Esta janela define quando a IA atende sozinha à noite. Com o noturno ativo, o aviso de "fora do horário" não é enviado.
        </p>
      </Card>
      <AsyncState status={form.status} skeletonLines={4}>
        <form onSubmit={(e) => { e.preventDefault(); form.save(); }}>
          <Card title="Janela noturna" scope="global" footer={<Button type="submit" loading={form.saving}>Salvar janela noturna</Button>}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id="triage-night-start" label="Início">
                <input id="triage-night-start" type="time" placeholder="20:00" value={form.values.nightStart} onChange={(e) => form.setValue('nightStart', e.target.value)} className={inputClass} />
              </Field>
              <Field id="triage-night-end" label="Fim">
                <input id="triage-night-end" type="time" placeholder="08:00" value={form.values.nightEnd} onChange={(e) => form.setValue('nightEnd', e.target.value)} className={inputClass} />
              </Field>
            </div>
            <HelpText>Todos os dias, feriados incluídos. Ex.: 20:00 a 08:00. Salve a janela antes de ligar o interruptor "Atendimento noturno" no canal: sem ela o canal recusa ligar.</HelpText>
            {form.error && <p role="alert" className="rounded-lg border border-wa-error-text/30 bg-wa-error-bg px-3 py-2 text-sm text-wa-error-text">{form.error}</p>}
          </Card>
        </form>
      </AsyncState>
      <Card title="Canais com noturno ligado" scope="channel">
        <AsyncState status={channelsStatus} isEmpty={noturnos.length === 0} emptyMessage="Nenhum canal com o noturno ligado. Ligue no detalhe do canal, aba Atendimento.">
          <ul className="space-y-1 text-[14px]">
            {noturnos.map((c) => <li key={c.id}><Link to={`/configuracoes/canais/${c.id}/atendimento`} className="text-wa-link hover:underline">{c.name}</Link></li>)}
          </ul>
        </AsyncState>
      </Card>
    </SettingsPage>
  );
}

export default NightModePage;
