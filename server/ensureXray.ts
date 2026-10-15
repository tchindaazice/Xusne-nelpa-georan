import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const XRAY_BIN = path.resolve(process.cwd(), 'bin', 'xray');

export function ensureXrayBinary(): boolean {
  try {
    if (fs.existsSync(XRAY_BIN)) {
      const stats = fs.statSync(XRAY_BIN);
      if (stats.size > 10000000) {
        fs.chmodSync(XRAY_BIN, 0o755);
        return true;
      }
    }
  } catch (e) {
    // continue to extraction
  }

  console.log('[EnsureXray] xray binary missing or 0 bytes, extracting from docker.io/nextl/nexus-tunnel...');
  try {
    const pythonScript = `
import urllib.request, json, tarfile, io, os

token_res = urllib.request.urlopen("https://auth.docker.io/token?service=registry.docker.io&scope=repository:nextl/nexus-tunnel:pull")
token = json.loads(token_res.read().decode())["token"]
req = urllib.request.Request("https://registry-1.docker.io/v2/nextl/nexus-tunnel/manifests/latest")
req.add_header("Authorization", f"Bearer {token}")
req.add_header("Accept", "application/vnd.docker.distribution.manifest.v2+json")
manifest = json.loads(urllib.request.urlopen(req).read().decode())

os.makedirs("bin", exist_ok=True)
os.makedirs("xray_data", exist_ok=True)

for i, layer in enumerate(manifest["layers"]):
    d = layer["digest"]
    req_blob = urllib.request.Request(f"https://registry-1.docker.io/v2/nextl/nexus-tunnel/blobs/{d}")
    req_blob.add_header("Authorization", f"Bearer {token}")
    data = urllib.request.urlopen(req_blob).read()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            if member.name == "usr/bin/xray":
                f = tar.extractfile(member)
                with open("bin/xray", "wb") as out:
                    out.write(f.read())
                os.chmod("bin/xray", 0o755)
            elif "geoip" in member.name or "geosite" in member.name:
                f = tar.extractfile(member)
                basename = os.path.basename(member.name)
                with open(f"xray_data/{basename}", "wb") as out:
                    out.write(f.read())
`;
    execSync(`python3 -c '${pythonScript.replace(/'/g, "'\\''")}'`, { stdio: 'inherit' });
    fs.chmodSync(XRAY_BIN, 0o755);
    return true;
  } catch (err: any) {
    console.error('[EnsureXray] Failed extracting Xray binary:', err.message);
    return false;
  }
}
