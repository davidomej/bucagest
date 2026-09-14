import { emptyWorkspace, applyCommand } from './domain.js';
export function demoWorkspace() {
  let workspace = emptyWorkspace('Sky Blue FC');
  const teamId = workspace.teams[0].id;
  const command = (type, payload, now) => { workspace = applyCommand(workspace, { type, teamId, payload }, now); };
  command('league.save', { name: 'Liga Municipal · Fútbol 7', season: '2026/27', color: '#8ac9eb' });
  const leagueId = workspace.leagues[0].id;
  command('settings', { ...workspace.teams[0].settings, leagueIds: [leagueId] });
  const names = [['Alejandro Martín',1,'POR','2009-03-12'],['Pablo Rodríguez',4,'DEF','2008-11-02'],['Hugo García',5,'DEF','2009-01-20'],['Daniel Pérez',6,'MED','2008-06-15'],['David Santana',8,'MED','2009-09-08'],['Álvaro Hernández',9,'DEL','2008-04-27'],['Lucas Díaz',10,'DEL','2009-07-19'],['Sergio Torres',13,'POR','2008-12-30'],['Marcos Suárez',3,'DEF','2009-02-14'],['Adrián López',7,'MED','2008-08-05'],['Diego Castro',11,'DEL','2009-05-23'],['Javier Ramos',14,'DEF','2008-10-11'],['Mario León',17,'MED','2009-04-03'],['Nicolás Vega',21,'DEL','2008-09-17']];
  for (const [name, number, position, birthdate] of names) command('player.save', { name, number, position, birthdate });
  const now = new Date(); now.setHours(18,0,0,0);
  for (const [index, opponent] of ['CD Atlántico','Unión Deportiva Norte','Racing del Sur','Sporting Costa','Atlético Central'].entries()) {
    const date = new Date(now); date.setDate(date.getDate() + (index-2)*7);
    command('fixture.save',{opponent,date:date.toISOString(),venue:index%2 ? 'Campo Municipal del Norte':'Ciudad Deportiva',home:index%2===0,round:index+1,season:workspace.teams[0].settings.season,leagueId});
  }
  const players = workspace.teams[0].players;
  for (let index=0;index<2;index++) {
    const id = workspace.teams[0].matches[index].id, start = now.getTime()-(14-index*7)*86400000;
    command('match.lineup',{matchId:id,playerIds:players.slice(0,7).map(p=>p.id)},start);
    command('match.start',{matchId:id},start);
    for (let n=0;n<3;n++) command('match.substitute',{matchId:id,outId:players[n+4].id,inId:players[n+8].id},start+1800000+n*180000);
    command('match.score',{matchId:id,homeScore:index===0?3:1,awayScore:index===0?1:2},start+3600000);
    command('match.finish',{matchId:id},start+3600000);
  }
  command('match.lineup',{matchId:workspace.teams[0].matches[2].id,playerIds:players.slice(0,7).map(p=>p.id)});
  return workspace;
}
