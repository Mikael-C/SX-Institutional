const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const HiddenOrder = sequelize.define('HiddenOrder', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    tier: {
      type: DataTypes.ENUM('HOBL', 'HOPL', 'HOTL'),
      allowNull: false
    },
    commitment: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    price: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('Hidden', 'Executed', 'Cancelled'),
      defaultValue: 'Hidden'
    },
    zkProof: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    txHash: {
      type: DataTypes.STRING,
      allowNull: true
    },
    executedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'hidden_orders',
    indexes: [
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['tier'] }
    ]
  });

  return HiddenOrder;
};
