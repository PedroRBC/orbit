import { connection } from "next/server";
import { requireSession } from "../../../lib/session";
import { getDatabase } from "../../../db/index";
import { getProfile } from "../../../lib/store";
import { learnedWeights } from "../../../lib/feedback";
import { listThemes } from "../../../lib/taxonomy";
import { saveProfile, saveTopicWeight } from "../../actions";
import { ActionForm, SubmitButton } from "../../components";

export const metadata = { title: "Meu perfil" };
export default async function ProfilePage() {
  await requireSession();
  await connection();
  const db = getDatabase();
  const profile = getProfile(db);
  const weights = learnedWeights(db);
  return <>
    <div className="page-heading"><div><h1>Um perfil que você entende.</h1><p>Suas preferências explícitas e o que o seu feedback ensinou ao Orbit.</p></div></div>
    <section className="panel"><h2>Seus interesses</h2><p>São enviados ao modelo nos próximos itens. Classificações já concluídas permanecem em cache.</p>
      <ActionForm action={saveProfile} className="stack-form"><label htmlFor="profile-interests">Seus interesses</label><textarea id="profile-interests" name="interests" rows={4} required maxLength={2000} defaultValue={profile?.interests ?? ""}/><label htmlFor="profile-excluded">O que você prefere evitar</label><textarea id="profile-excluded" name="excluded" rows={3} maxLength={2000} defaultValue={profile?.excluded ?? ""}/><SubmitButton>Salvar interesses</SubmitButton></ActionForm>
    </section>
    <section id="temas" className="panel learned-panel" aria-labelledby="themes-title"><h2 id="themes-title">Temas e pesos do seu perfil</h2><p>Temas base do Orbit e temas criados a partir do seu conteúdo. Um zero sem feedback ou ajuste manual é só uma exibição neutra: não cria preferência nem é salvo automaticamente.</p><p>Gostei: +3. Não gostei: -3. Salvar: +1. Primeiro clique no original: +1. Já vi apenas organiza sua lista. Repetir um voto o desfaz.</p><p className="field-help">Cada unidade ajusta em 2 pontos a relevância local, limitada a 0–100. Pesos entre -20 e 20 também entram nos próximos prompts. Rótulos antigos do mesmo tema são consolidados pela média, sem somar preferências. Você pode editar os valores, inclusive decimais; novos sinais ajustam esse ponto de partida. Os sinais são somados antes de limitar a exibição: no teto, sinais opostos podem reduzir o acumulado antes de mudar a nota.</p>
      <div className="weight-list">{listThemes(db).map(theme => {
        const weight = Object.hasOwn(weights, theme.id) ? weights[theme.id] : 0;
        return <ActionForm action={saveTopicWeight} key={theme.id} className="weight-form"><input type="hidden" name="theme" value={theme.id}/><label htmlFor={`weight-${theme.id}`}>{theme.label}<br/><small id={`scope-${theme.id}`} className="field-help">{theme.description}</small></label><input type="number" id={`weight-${theme.id}`} name="weight" min={-20} max={20} step="any" defaultValue={weight} key={weight} aria-label={`Peso de ${theme.label}`} aria-describedby={`scope-${theme.id}`} required/><SubmitButton className="button secondary" label={`Salvar peso de ${theme.label}`}>Salvar peso</SubmitButton></ActionForm>;
      })}</div>
    </section>
  </>;
}
