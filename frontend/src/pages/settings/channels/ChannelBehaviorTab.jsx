import { Link, useOutletContext } from 'react-router-dom';
import { useTriage } from '../../../hooks/useTriage';
import { useAiConfig } from '../../../hooks/useAiConfig';
import { useBusinessHoursConfig } from '../../../hooks/useBusinessHoursConfig';
import { computeStatus } from '../../../components/OpenAiConfigCard';
import { InterruptorDoCanal } from './InterruptorDoCanal';

// Aba Atendimento do detalhe do canal (Fatia S2, primeiro mockup): as
// automações deste canal, cada uma com envio, deduplicação e restauração
// (InterruptorDoCanal), e ao lado as regras globais que valem para ele.
//
// As regras de antes continuam: um robô por vez (ligar a IA desliga a triagem
// por menu, na ordem de useChannelActions); a triagem com IA exige a IA; o
// noturno exige a triagem com IA e a janela — e, já ligado, pode sempre ser
// desligado, mesmo sem a janela.
function LinhaRelacionada({ to, rotulo, valor }) {
  return (
    <div className="cfg-linha">
      <dt><Link to={to}>{rotulo}</Link></dt>
      <dd><span className="cfg-linha-valor">{valor}</span></dd>
    </div>
  );
}

function ChannelBehaviorTab() {
  const { channel, actions } = useOutletContext();
  const { options } = useTriage();
  const { config: aiConfig } = useAiConfig();
  const { config: businessHours } = useBusinessHoursConfig();

  const janelaDefinida = Boolean(aiConfig.nightStartTime && aiConfig.nightEndTime);
  const openAi = computeStatus({ mode: aiConfig.mode, configured: aiConfig.configured, hasError: false });

  const noturnoIndisponivel = !channel.aiNightModeEnabled && (!channel.aiTriageEnabled || !janelaDefinida);
  const motivoDoNoturno = !channel.aiTriageEnabled ? (
    'Precisa de Triagem com IA ligada'
  ) : (
    <Link to="/configuracoes/automacao/noturno">Defina a janela em IA e automações › Atendimento noturno</Link>
  );

  return (
    <div className="cfg-atendimento">
      <section aria-labelledby="cfg-automacoes-titulo" className="cfg-secao">
        <div className="cfg-cartao">
          <h2 id="cfg-automacoes-titulo">Automações deste canal</h2>
          <InterruptorDoCanal
            rotulo="Triagem por menu"
            descricao="O cliente escolhe uma opção antes do atendimento."
            ligado={channel.triageEnabled}
            onAlterar={(ligado) => actions.definirTriagem(channel.id, ligado)}
          />
          <InterruptorDoCanal
            rotulo="Atendimento com IA"
            descricao="Ao ativar, a triagem por menu é desligada neste canal: só um robô responde por vez."
            ligado={channel.aiEnabled}
            onAlterar={(ligado) => actions.definirIa(channel.id, ligado)}
          />
          <InterruptorDoCanal
            rotulo="Triagem com IA"
            descricao="A IA identifica o assunto e encaminha o atendimento."
            ligado={channel.aiTriageEnabled}
            indisponivel={!channel.aiEnabled}
            motivo="Precisa de Atendimento com IA ligado"
            onAlterar={(ligado) => actions.definirTriagemIa(channel.id, ligado)}
          />
          <InterruptorDoCanal
            rotulo="Atendimento noturno"
            descricao="A IA atende sozinha dentro da janela noturna."
            ligado={channel.aiNightModeEnabled}
            indisponivel={noturnoIndisponivel}
            motivo={motivoDoNoturno}
            onAlterar={(ligado) => actions.definirNoturno(channel.id, ligado)}
          />
        </div>
      </section>

      <section aria-labelledby="cfg-regras-titulo" className="cfg-secao">
        <div className="cfg-cartao">
          <h2 id="cfg-regras-titulo">Regras relacionadas</h2>
          <dl className="cfg-linhas">
            <LinhaRelacionada
              to="/configuracoes/automacao/triagem-menu"
              rotulo="Triagem por menu"
              valor={options.length === 0 ? 'sem opções' : `${options.length} ${options.length === 1 ? 'opção' : 'opções'}`}
            />
            <LinhaRelacionada to="/configuracoes/mensagens/boas-vindas" rotulo="Boas-vindas" valor={channel.welcomeMessage || 'não definida'} />
            <LinhaRelacionada
              to="/configuracoes/regras/horario"
              rotulo="Horário de atendimento"
              valor={businessHours.enabled ? `${businessHours.startTime}–${businessHours.endTime}` : 'não configurado'}
            />
            <LinhaRelacionada
              to="/configuracoes/automacao/noturno"
              rotulo="Janela noturna"
              valor={janelaDefinida ? `${aiConfig.nightStartTime}–${aiConfig.nightEndTime}` : 'não definida'}
            />
            <LinhaRelacionada to="/configuracoes/integracoes/openai" rotulo="OpenAI" valor={openAi} />
          </dl>
        </div>
      </section>
    </div>
  );
}

export default ChannelBehaviorTab;
