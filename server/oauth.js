import {createHash,createHmac} from 'node:crypto';
import {createRemoteJWKSet,importPKCS8,jwtVerify,SignJWT} from 'jose';
import {z} from 'zod';
import {AppError} from './domain.js';

const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleKeys=createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const failure=()=>new AppError('No se pudo verificar el acceso con el proveedor. Vuelve a intentarlo.',400);
export async function verifyIdentityToken(token,{provider,clientId,nonce,keys}){
  const {payload}=await jwtVerify(token,keys??(provider==='google'?googleKeys:appleKeys),{
    issuer:provider==='google'?['https://accounts.google.com','accounts.google.com']:'https://appleid.apple.com',
    audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce'],clockTolerance:5
  });
  if(payload.nonce!==nonce || typeof payload.sub!=='string' || !payload.sub || (payload.azp && payload.azp!==clientId))throw failure();
  return payload;
}
export function createProviders(env=process.env,origin=env.APP_ORIGIN,send=fetch){
  const providers={};
  if(!origin)return providers;
  async function json(url,options={}){
    const response=await send(url,{...options,signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw failure();
    return response.json();
  }
  function add(id,{clientId,secret,authorize,token,scopes}){
    const redirectUri=`${origin}/api/auth/${id}/callback`;
    providers[id]={
      async authorize({state,nonce,verifier}){
        const url=new URL(authorize);
        Object.entries({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:scopes,state}).forEach(([k,v])=>url.searchParams.set(k,v));
        if(id!=='facebook')url.searchParams.set('nonce',nonce);
        if(id==='google'){
          url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));
          url.searchParams.set('code_challenge_method','S256');
          url.searchParams.set('prompt','select_account');
        }
        if(id==='apple')url.searchParams.set('response_mode','form_post');
        return url.toString();
      },
      async identity(code,{nonce,verifier}){
        const clientSecret=typeof secret==='function'?await secret():secret;
        const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:clientId,client_secret:clientSecret});
        if(id==='google')body.set('code_verifier',verifier);
        const tokens=await json(token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
        if(id==='facebook'){
          if(typeof tokens.access_token!=='string')throw failure();
          const proof=createHmac('sha256',clientSecret).update(tokens.access_token).digest('hex');
          const profile=await json(`https://graph.facebook.com/${env.FACEBOOK_API_VERSION}/me?fields=id,name,email&appsecret_proof=${proof}`,{headers:{Authorization:`Bearer ${tokens.access_token}`}});
          const subject=z.string().min(1).max(255).parse(profile.id);
          return {provider:id,subject,email:profile.email?z.email().max(254).parse(profile.email).toLowerCase():null,name:typeof profile.name==='string'?profile.name.slice(0,100):'Entrenador',emailVerified:false};
        }
        if(typeof tokens.id_token!=='string')throw failure();
        const claims=await verifyIdentityToken(tokens.id_token,{provider:id,clientId,nonce});
        return {provider:id,subject:claims.sub,email:claims.email?z.email().max(254).parse(claims.email).toLowerCase():null,name:typeof claims.name==='string'?claims.name.slice(0,100):'Entrenador',emailVerified:claims.email_verified===true||claims.email_verified==='true'};
      }
    };
  }
  if(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)add('google',{clientId:env.GOOGLE_CLIENT_ID,secret:env.GOOGLE_CLIENT_SECRET,authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scopes:'openid email profile'});
  if(env.APPLE_CLIENT_ID&&env.APPLE_TEAM_ID&&env.APPLE_KEY_ID&&env.APPLE_PRIVATE_KEY&&origin.startsWith('https://'))add('apple',{
    clientId:env.APPLE_CLIENT_ID,authorize:'https://appleid.apple.com/auth/authorize',token:'https://appleid.apple.com/auth/token',scopes:'name email',
    secret:async()=>new SignJWT({}).setProtectedHeader({alg:'ES256',kid:env.APPLE_KEY_ID}).setIssuer(env.APPLE_TEAM_ID).setSubject(env.APPLE_CLIENT_ID).setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(await importPKCS8(env.APPLE_PRIVATE_KEY.replaceAll('\\n','\n'),'ES256'))
  });
  if(env.FACEBOOK_CLIENT_ID&&env.FACEBOOK_CLIENT_SECRET&&/^v\d+\.\d+$/.test(env.FACEBOOK_API_VERSION??''))add('facebook',{clientId:env.FACEBOOK_CLIENT_ID,secret:env.FACEBOOK_CLIENT_SECRET,authorize:`https://www.facebook.com/${env.FACEBOOK_API_VERSION}/dialog/oauth`,token:`https://graph.facebook.com/${env.FACEBOOK_API_VERSION}/oauth/access_token`,scopes:'email,public_profile'});
  return providers;
}
