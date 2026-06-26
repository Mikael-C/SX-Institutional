const { Sequelize } = require('sequelize');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://stanbicx_deployer_user:qt5JPLvQzAlbfYV2d9Un43tvbmBqF5so@dpg-d8p5miho3t8c73ecibq0-a.oregon-postgres.render.com/stanbicx_deployer';

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  pool: {
    min: 0,
    max: 10,
    acquire: 30000,
    idle: 10000
  },
  logging: process.env.NODE_ENV === 'production' ? false : console.log,
  define: {
    timestamps: true,
    underscored: false
  }
});

module.exports = sequelize;
