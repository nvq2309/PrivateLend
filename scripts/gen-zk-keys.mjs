import fs from "fs";
import path from "path";

const actions = ["supply", "borrow", "repay", "withdraw"];
const baseDir = path.resolve("circuits/veillend/build");
const outputPath = path.resolve("programs/veillend/src/zk_keys.rs");

const fq = (value) => `MontFp!("${value}")`;
const fq2 = (pair) => `Fq2::new(${fq(pair[0])}, ${fq(pair[1])})`;
const g1 = (point) => `G1Affine::new_unchecked(${fq(point[0])}, ${fq(point[1])})`;
const g2 = (point) =>
  `G2Affine::new_unchecked(${fq2(point[0])}, ${fq2(point[1])})`;

const renderVk = (name, vk) => {
  const alpha = g1(vk.vk_alpha_1);
  const beta = g2(vk.vk_beta_2);
  const gamma = g2(vk.vk_gamma_2);
  const delta = g2(vk.vk_delta_2);
  const ic = vk.IC.map((point) => g1(point)).join(",\n        ");

  return `pub fn ${name}() -> VerifyingKey<Bn254> {\n    VerifyingKey {\n        alpha_g1: ${alpha},\n        beta_g2: ${beta},\n        gamma_g2: ${gamma},\n        delta_g2: ${delta},\n        gamma_abc_g1: vec![\n        ${ic}\n        ],\n    }\n}`;
};

const header = `use ark_bn254::{Bn254, Fq2, G1Affine, G2Affine};\nuse ark_ff::MontFp;\nuse ark_groth16::VerifyingKey;\n\n`;

const body = actions
  .map((action) => {
    const keyPath = path.join(baseDir, action, "verification_key.json");
    const vk = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    return renderVk(`vk_${action}`, vk);
  })
  .join("\n\n");

fs.writeFileSync(outputPath, `${header}${body}\n`);
