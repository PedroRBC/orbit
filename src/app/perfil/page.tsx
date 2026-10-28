import { connection } from "next/server";
import { getDatabase } from "../../db/index";
import { getProfile } from "../../lib/store";
import { learnedWeights } from "../../lib/feedback";
import { saveProfile, saveTopicWeight } from "../actions";
import { ActionForm, SubmitButton } from "../components";

export const metadata = { title: "Meu perfil" };
export default async function ProfilePage() {
  await connection();
  const db = getDatabase();
  const profile = getProfile(db);
  const weights = learnedWeights(db);
  return <>
    <div className="page-heading"><div><h1>Um perfil que você entende.</h1><p>Suas preferências explícitas e o que o seu feedback ensinou ao Orbit.</p></div></div>
    <section className="panel"><h2>Seus interesses</h2><p>São enviados ao modelo nos próximos itens. Classificações já concluídas permanecem em cache.</p>
      <ActionForm action={saveProfile} className="stack-form"><label htmlFor="profile-interests">Seus interesses</label><textarea id="profile-interests" name="interests" rows={4} required maxLength={2000} defaultValue={profile?.interests ?? ""}/><label htmlFor="profile-excluded">O que você prefere evitar</label><textarea id="profile-excluded" name="excluded" rows={3} maxLength={2000} defaultValue={profile?.excluded ?? ""}/><SubmitButton>Salvar interesses</SubmitButton></ActionForm>
    </section>
    <section className="panel learned-panel"><h2>O que seu feedback está dizendo</h2><p>Gostei: +3. Não gostei: -3. Salvar: +1. Primeiro clique no original: +1. Já vi apenas organiza sua lista. Repetir um voto o desfaz.</p><p className="field-help">Cada unidade ajusta em 2 pontos a relevância local, limitada a 0–100. Pesos entre -20 e 20 também entram nos próximos prompts. Você pode editar os valores; novos sinais ajustam esse ponto de partida. Os sinais são somados antes de limitar a exibição: no teto, sinais opostos podem reduzir o acumulado antes de mudar a nota.</p>
      {Object.keys(weights).length ? <div className="weight-list">{Object.entries(weights).sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([theme, weight]) => <ActionForm action={saveTopicWeight} key={theme} className="weight-form"><input type="hidden" name="theme" value={theme}/><label htmlFor={`weight-${encodeURIComponent(theme)}`}>{theme}</label><input type="number" id={`weight-${encodeURIComponent(theme)}`} name="weight" min={-20} max={20} step={1} defaultValue={weight} key={weight} aria-label={`Peso de ${theme}`} required/><SubmitButton className="button secondary" label={`Salvar peso de ${theme}`}>Salvar peso</SubmitButton></ActionForm>)}</div> : <div className="empty-state compact"><h3>Seu aprendizado ainda está em branco.</h3><p>Ao reagir ou abrir um item recomendado, os temas e seus pesos aparecem aqui. Nenhuma preferência é presumida.</p></div>}
    </section>
  </>;
}
