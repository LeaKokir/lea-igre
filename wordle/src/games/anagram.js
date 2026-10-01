function normalize(v){return v.toLowerCase().trim().replaceAll("č","c").replaceAll("ć","c").replaceAll("š","s").replaceAll("ž","z").replaceAll("đ","dj");}
function sameLetters(a,b){return normalize(a).split("").sort().join("")===normalize(b).split("").sort().join("");}
module.exports={normalize,sameLetters};
