const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535){
  console.error('Healthcheck: PORT debe ser un puerto válido entre 1 y 65535.');
  process.exit(1);
}
try{
  const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(4000),redirect:'error'});
  if(!response.ok){
    console.error(`Healthcheck: /api/health respondió HTTP ${response.status} en el puerto ${port}.${response.status===503?' Comprueba la conexión con PostgreSQL.':''}`);
    process.exit(1);
  }
  console.log(`Healthcheck OK: aplicación y PostgreSQL disponibles en el puerto ${port}.`);
  process.exit(0);
}catch(error){
  const reason=error.name==='TimeoutError'?'La aplicación no respondió en 4 segundos.':
    error.cause?.code==='ECONNREFUSED'?'La aplicación aún no escucha en este puerto. Revisa los logs de arranque.':
    'No se pudo consultar la aplicación. Revisa los logs de arranque.';
  console.error(`Healthcheck: ${reason} Puerto ${port}.`);
  process.exit(1);
}
