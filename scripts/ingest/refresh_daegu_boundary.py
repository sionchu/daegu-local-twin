import json, urllib.parse, urllib.request
from pathlib import Path

q="대구광역시 대한민국"
params=urllib.parse.urlencode({"format":"jsonv2","polygon_geojson":"1","limit":"10","q":q})
req=urllib.request.Request("https://nominatim.openstreetmap.org/search?"+params,headers={"User-Agent":"LocalTwin-Daegu/0.3"})
with urllib.request.urlopen(req,timeout=30) as r:
    data=json.load(r)
for item in data:
    geo=item.get("geojson") or {}
    if item.get("osm_type")=="relation" and geo.get("type") in ("Polygon","MultiPolygon"):
        out={"type":"FeatureCollection","name":"Daegu administrative boundary","metadata":{"sourceProvider":"OpenStreetMap contributors","sourceUrl":"https://www.openstreetmap.org/","sourceMode":"public-map-boundary","boundaryMeaning":"지도 표시 범위 제한용 대구광역시 행정경계","osmType":item.get("osm_type"),"osmId":item.get("osm_id"),"displayName":item.get("display_name")},"features":[{"type":"Feature","properties":{"name":"대구광역시","source":"OpenStreetMap"},"geometry":geo}]}
        Path("public/data/daegu_boundary.geojson").write_text(json.dumps(out,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
        print({"osm_id":item.get("osm_id"),"type":geo.get("type"),"display":item.get("display_name")})
        break
else:
    raise SystemExit("No Daegu polygon relation found")
