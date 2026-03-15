(function () {

const MANIFEST_URL = "art-manifest.json";
const API_URL = "/api/art/resolve";

let manifest = null;

async function loadManifest(){
    if(manifest) return manifest;
    const r = await fetch(MANIFEST_URL);
    manifest = await r.json();
    return manifest;
}

function normalize(str){
    return (str || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g,"");
}

function key(artist,title){
    return normalize(artist)+"-"+normalize(title);
}

function findManifestArt(artist,title){
    if(!manifest) return null;

    const k = key(artist,title);

    for(const t of manifest.tracks){
        if(key(t.artist,t.title)===k){
            return t.art;
        }
    }

    for(const a of manifest.artists){
        if(normalize(a.artist)===normalize(artist)){
            return a.art;
        }
    }

    return null;
}

async function resolveArt({artist,title}){

    await loadManifest();

    let art = findManifestArt(artist,title);

    if(art) return {url:art};

    try{

        const r = await fetch(API_URL,{
            method:"POST",
            headers:{"content-type":"application/json"},
            body:JSON.stringify({artist,title})
        });

        const data = await r.json();

        if(data.url) return {url:data.url};

    }catch(e){}

    return {url:null};
}

function parseTrack(raw){

    if(!raw) return {artist:"",title:""};

    const parts = raw.split(" - ");

    if(parts.length>=2){
        return {
            artist:parts[0].trim(),
            title:parts.slice(1).join(" - ").trim()
        };
    }

    return {artist:"",title:raw.trim()};
}

window.M4MArt = {
    resolveArt,
    parseTrack
};

})();
