import { Icone } from './Icone';
import * as desenhos from './desenhosSgp';

// Os ícones do painel do SGP, num módulo à parte da família: só o painel (que
// chega sob demanda) os importa, e a mesa não leva os desenhos deles.
export function IconeCodigoPix(props) { return <Icone desenho={desenhos.codigoPix} {...props} />; }
export function IconeQrPix(props) { return <Icone desenho={desenhos.qrPix} {...props} />; }
export function IconeCodigoBarras(props) { return <Icone desenho={desenhos.codigoBarras} {...props} />; }
export function IconeLinkFatura(props) { return <Icone desenho={desenhos.linkFatura} {...props} />; }
export function IconePdfFatura(props) { return <Icone desenho={desenhos.pdfFatura} {...props} />; }
