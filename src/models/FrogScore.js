const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FrogScore = sequelize.define('FrogScore', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0,
        max: 200
      }
    },
    fundingRate: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    openInterest: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    spotPremium: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    interpretation: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'frog_scores',
    indexes: [
      { fields: ['score'] },
      { fields: ['createdAt'] }
    ]
  });

  return FrogScore;
};
