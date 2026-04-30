require("dotenv").config();
// 生产环境建议改成随机长字符串，或从环境变量读取
// export JWT_SECRET=你的密钥 然后用 process.env.JWT_SECRET
module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'sukura_secret_change_this_in_production_2025',
  PORT: process.env.PORT || 3000,
};
