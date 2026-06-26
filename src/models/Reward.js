const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Reward = sequelize.define('Reward', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    tradeVolume: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'swap'
    },
    txHash: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'rewards',
    indexes: [
      { fields: ['userId'] },
      { fields: ['source'] }
    ]
  });

  return Reward;
};
