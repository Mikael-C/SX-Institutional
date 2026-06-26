const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RiskScore = sequelize.define('RiskScore', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0,
        max: 100
      }
    },
    borrowingPower: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    volatility: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    correlation: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    concentration: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    }
  }, {
    tableName: 'risk_scores',
    indexes: [
      { fields: ['userId'] },
      { fields: ['score'] }
    ]
  });

  return RiskScore;
};
