import fs from "fs";
import path from "path";

const actions = ["supply", "borrow", "repay", "withdraw"];
const baseDir = path.resolve("circuits/veillend/build");
const outputPath = path.resolve("programs/veillend/src/zk_keys.rs");

const toBytes = (n) => {
  let hex = BigInt(n).toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const len = 64; // 32 bytes * 2 chars
  while (hex.length < len) hex = "0" + hex;
  const bytes = [];
  for (let i = 0; i < len; i += 2) {
    bytes.push("0x" + hex.slice(i, i + 2));
  }
  return bytes;
};

const formatBytes = (bytes, indent) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 15) {
    s += indent + bytes.slice(i, i + 15).join(", ") + ",\n";
  }
  return s;
};

const renderVk = (name, vk) => {
  const alpha = [...toBytes(vk.vk_alpha_1[0]), ...toBytes(vk.vk_alpha_1[1])];
  
  // Beta2: X=[c1, c0], Y=[c1, c0] (Ethereum/Solana format: imaginary first)
  // JSON: [[x_c0, x_c1], [y_c0, y_c1], ...]
  const beta = [
    ...toBytes(vk.vk_beta_2[0][1]), ...toBytes(vk.vk_beta_2[0][0]),
    ...toBytes(vk.vk_beta_2[1][1]), ...toBytes(vk.vk_beta_2[1][0])
  ];

  const gamma = [
    ...toBytes(vk.vk_gamma_2[0][1]), ...toBytes(vk.vk_gamma_2[0][0]),
    ...toBytes(vk.vk_gamma_2[1][1]), ...toBytes(vk.vk_gamma_2[1][0])
  ];

  const delta = [
    ...toBytes(vk.vk_delta_2[0][1]), ...toBytes(vk.vk_delta_2[0][0]),
    ...toBytes(vk.vk_delta_2[1][1]), ...toBytes(vk.vk_delta_2[1][0])
  ];

  const ic = vk.IC.map(point => {
    const bytes = [...toBytes(point[0]), ...toBytes(point[1])];
    return `        [\n${formatBytes(bytes, "            ")}        ]`;
  }).join(",\n");

  return `pub const ${name.toUpperCase()}_VK: VkBytes = VkBytes {
    alpha_1: [
${formatBytes(alpha, "        ")}    ],
    beta_2: [
${formatBytes(beta, "        ")}    ],
    gamma_2: [
${formatBytes(gamma, "        ")}    ],
    delta_2: [
${formatBytes(delta, "        ")}    ],
    ic: [
${ic}
    ],
};`;
};

const header = `use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VkBytes {
    pub alpha_1: [u8; 64],
    pub beta_2: [u8; 128],
    pub gamma_2: [u8; 128],
    pub delta_2: [u8; 128],
    pub ic: [[u8; 64]; 5],
}

`;

const body = actions
  .map((action) => {
    const keyPath = path.join(baseDir, action, "verification_key.json");
    if (!fs.existsSync(keyPath)) {
        console.warn(`Warning: ${keyPath} not found`);
        return "";
    }
    const vk = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    return renderVk(action, vk);
  })
  .join("\n\n");

fs.writeFileSync(outputPath, `${header}${body}\n`);
console.log("Generated zk_keys.rs");
