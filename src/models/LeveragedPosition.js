const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LeveragedPosition = sequelize.define('LeveragedPosition', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    asset: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ETH'
    },
    leverage: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 100
      }
    },
    amount: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    entryPrice: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    currentPrice: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    liquidationPrice: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    margin: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    protection: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    protectionActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    status: {
      type: DataTypes.ENUM('Open', 'Closed', 'Liquidated'),
      defaultValue: 'Open'
    },
    chain: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Hoodi'
    }
  }, {
    tableName: 'leveraged_positions',
    indexes: [
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['chain'] },
      { fields: ['userId', 'status'] }
    ]
  });

  return LeveragedPosition;
};
