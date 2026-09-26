const channelName='minuto-session';
const storageKey='minuto-session-changed';
const source=crypto.randomUUID();

// Only a change signal is shared. Account data and credentials stay out of storage.
export function publishSessionChange(){
  try{const channel=new BroadcastChannel(channelName);channel.postMessage({type:'changed',source});channel.close();}
  catch{try{localStorage.setItem(storageKey,crypto.randomUUID());}catch{/* Storage can be disabled. */}}
}

export function subscribeSessionChange(changed:()=>void){
  let channel:BroadcastChannel|undefined;
  try{channel=new BroadcastChannel(channelName);channel.onmessage=event=>{if(event.data?.type==='changed'&&event.data.source!==source)changed();};}catch{/* Use storage events instead. */}
  const storage=(event:StorageEvent)=>{if(event.key===storageKey)changed();};
  window.addEventListener('storage',storage);
  return()=>{channel?.close();window.removeEventListener('storage',storage);};
}
