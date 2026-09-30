import { Icone } from './Icone';
import { informacoesComerciais } from './desenhoInformacoesComerciais';

// Sozinho no arquivo pelo mesmo motivo do desenho: o Encerrar e Configurações
// (Planos) o usam, e Configurações não leva os outros motivos.
export function IconeMotivoInformacoesComerciais(props) { return <Icone desenho={informacoesComerciais} {...props} />; }
