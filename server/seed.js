import { emptyTeam, applyCommand } from './domain.js';
export function demoTeam() {
  let team = emptyTeam('Sky Blue FC');
  team.settings.league = 'Liga Municipal · Fútbol 7';
  const names = [['Alejandro Martín',1,'POR'],['Pablo Rodríguez',4,'DEF'],['Hugo García',5,'DEF'],['Daniel Pérez',6,'MED'],['David Santana',8,'MED'],['Álvaro Hernández',9,'DEL'],['Lucas Díaz',10,'DEL'],['Sergio Torres',13,'POR'],['Marcos Suárez',3,'DEF'],['Adrián López',7,'MED'],['Diego Castro',11,'DEL'],['Javier Ramos',14,'DEF'],['Mario León',17,'MED'],['Nicolás Vega',21,'DEL']];
  for (const [name, number, position] of names) team = applyCommand(team, { type:'player.save', payload:{name,number,position} });
  const now = new Date(); now.setHours(18,0,0,0);
  for (const [index, opponent] of ['CD Atlántico','Unión Deportiva Norte','Racing del Sur','Sporting Costa','Atlético Central'].entries()) {
    const date = new Date(now); date.setDate(date.getDate() + (index-2)*7);
    team = applyCommand(team, {type:'fixture.save',payload:{opponent,date:date.toISOString(),venue:index%2 ? 'Campo Municipal del Norte':'Ciudad Deportiva',home:index%2===0,round:index+1,season:team.settings.season}});
  }
  for (let index=0;index<2;index++) {
    const id = team.matches[index].id, start = now.getTime()-(14-index*7)*86400000;
    team = applyCommand(team,{type:'match.lineup',payload:{matchId:id,playerIds:team.players.slice(0,7).map(p=>p.id)}},start);
    team = applyCommand(team,{type:'match.start',payload:{matchId:id}},start);
    for (let n=0;n<3;n++) team = applyCommand(team,{type:'match.substitute',payload:{matchId:id,outId:team.players[n+4].id,inId:team.players[n+8].id}},start+1800000+n*180000);
    team = applyCommand(team,{type:'match.score',payload:{matchId:id,homeScore:index===0?3:1,awayScore:index===0?1:2}},start+3600000);
    team = applyCommand(team,{type:'match.finish',payload:{matchId:id}},start+3600000);
  }
  team = applyCommand(team,{type:'match.lineup',payload:{matchId:team.matches[2].id,playerIds:team.players.slice(0,7).map(p=>p.id)}});
  return team;
}
