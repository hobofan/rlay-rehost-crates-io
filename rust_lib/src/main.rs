// mod cid_mapping;
schema_module!(schema, "../ontology/build/schema.json");

use rlay_client_lib_experiment::prelude::*;
use rlay_ontology::ontology::*;
use serde::Deserialize;
use std::convert::Infallible;
use std::path::PathBuf;
use std::str::FromStr;
use warp::http::Uri;
use warp::Filter;

use crate::schema::*;

const INDEX_PATH: &'static str = "/Users/hobofan/stuff/hobofan-crates.io-index";
const CRATES_IO_DOWNLOAD_URL: &'static str = "https://crates.io/api/v1/crates";

fn get_index_subdirectory_name(crate_name: &str) -> String {
    match crate_name.len() {
        1 | 2 => crate_name.len().to_string(),
        3 => format!("3/{}", &crate_name[0..1]),
        _ => format!("{}/{}", &crate_name[0..2], &crate_name[2..4]),
    }
}

fn get_index_crate_filename(index_path: &str, crate_name: &str) -> PathBuf {
    let dir_name = get_index_subdirectory_name(crate_name);

    dbg!(&dir_name);
    PathBuf::from(index_path).join(dir_name).join(crate_name)
}

#[derive(Deserialize)]
struct CrateInfoLine {
    pub vers: String,
    pub cksum: String,
}

fn get_checksum_from_index(index_path: &str, crate_name: &str, crate_version: &str) -> String {
    let filename = get_index_crate_filename(index_path, crate_name);
    let content = std::fs::read_to_string(filename).unwrap();

    let cksum = content
        .lines()
        .map(|line| {
            let parsed_line: CrateInfoLine = serde_json::from_str(line).unwrap();
            parsed_line
        })
        .find(|line| line.vers == crate_version)
        .map(|matching_line| matching_line.cksum)
        .unwrap();
    cksum
}

fn crates_io_download_url(base_url: &str, crate_name: &str, crate_version: &str) -> String {
    format!("{}/{}/{}/download", base_url, crate_name, crate_version)
}

/// Returns a tuple that contains the Individual in the first field,
/// and a Vec of Entities it's made up of in the second field
fn build_main_url_individual(main_url: &str, cksum: &str) -> (Individual, Vec<Entity>) {
    individual_with_children! {{
        url_annotation_property(): &main_url.cbor_bytes_no_prefix(),
        sha256_checksum(): &cksum.cbor_bytes_no_prefix(),
    }}
}

// TODO: interface for resolving
//
// let ind = todo_individual!();
// let backend = todo_connection!();
// let property = todo_property!();
//
// // Probably doesn't work well enough. Not specific enough with types
// ind
//  .assertions(&backend)
//  .await
//  .into_iter()
//  .filter(property.matches)
//  .collect();
//
// ind
//  .resolve(&backend)
//  .await
//  .outgoing()
//  .data_assertions()
//  .filter_map(property.matching_values)
//  .collect();

// const listAlternativeUrls = async individual => {
// await individual.resolve();
// let alternativeUrls = castArray(individual.alternativeUrl);
// alternativeUrls = alternativeUrls.filter(Boolean);

// console.log('Alternative URLs', alternativeUrls);

// return alternativeUrls;
// };

// const getIpfsAlternative = async originalIndividual => {
// const alternativeUrls = await listAlternativeUrls(originalIndividual);
// let alternativeUrl = alternativeUrls.find(n => n.startsWith('ipfs://'));
// if (!alternativeUrl) {
// return null;
// }

// return alternativeUrl.replace('ipfs://', 'http://localhost:8080/ipfs/');
// };

async fn handle_download_request(
    crate_name: String,
    crate_version: String,
) -> Result<impl warp::Reply, Infallible> {
    let checksum = get_checksum_from_index(INDEX_PATH, &crate_name, &crate_version);
    let crates_io_url = crates_io_download_url(CRATES_IO_DOWNLOAD_URL, &crate_name, &crate_version);

    let (checksum_ind, checksum_children) = build_main_url_individual(&crates_io_url, &checksum);

    Ok(warp::redirect::temporary(
        Uri::from_str(&crates_io_url).unwrap(),
    ))
}

#[tokio::main]
async fn main() {
    // GET /hello/warp => 200 OK with body "Hello, warp!"
    let hello = warp::path!("crates" / "api" / "v1" / "crates" / String / String / "download")
        .and_then(handle_download_request);

    warp::serve(hello).run(([127, 0, 0, 1], 23788)).await;
}

#[cfg(test)]
mod test {
    use super::get_index_subdirectory_name;

    #[test]
    fn subdir_name() {
        assert_eq!("2".to_owned(), get_index_subdirectory_name("ab"));
        assert_eq!("3/a".to_owned(), get_index_subdirectory_name("aoa"));
        assert_eq!("se/rd".to_owned(), get_index_subdirectory_name("serde"));
    }
}
